/**
 * End-to-end check against a running local Supabase (`npx supabase start`).
 *
 * Exercises the real PostgREST + Realtime + Auth stack the app talks to, using
 * password sign-in to stand in for Google OAuth (identical from the database's
 * point of view — both produce an authenticated JWT).
 *
 *   node supabase/_localtest/e2e.mjs
 */
import { createClient } from "@supabase/supabase-js";

const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
// Default to the standard local Supabase demo keys, which are identical on
// every `supabase start` install and are not secrets. Override via env to
// point these scripts at another stack.
const ANON = process.env.SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";



let passed = 0;
const failures = [];

function check(label, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  ok  ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const admin = createClient(API, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function makeUser(email, fullName) {
  // Idempotent: reuse the account if a previous run already made it. Deleting
  // and recreating would give the same person a new uuid and orphan their
  // history, which is exactly what the schema is designed to avoid.
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list?.users.find((u) => u.email === email);

  // Mirrors what Google puts in raw_user_meta_data.
  const metadata = {
    full_name: fullName,
    avatar_url: `https://example.com/${fullName}.png`,
  };

  let userId = existing?.id;
  if (existing) {
    // Converge the metadata rather than just reusing the row, so this run's
    // expectations hold no matter which script created the account.
    const { error } = await admin.auth.admin.updateUserById(existing.id, {
      user_metadata: metadata,
    });
    if (error) throw error;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "test-password-123",
      email_confirm: true,
      user_metadata: metadata,
    });
    if (error) throw error;
    userId = data.user.id;
  }

  const client = createClient(API, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: "test-password-123",
  });
  if (signInError) throw signInError;

  // Hand the access token to Realtime explicitly, exactly as
  // src/lib/hooks/use-room-realtime.ts has to. Without this, whichever channel
  // subscribes first races the token reaching the realtime client and can be
  // evaluated as `anon` -- which this schema grants nothing. The channel still
  // reports SUBSCRIBED and then silently delivers no events, so the symptom is
  // a realtime check that fails with an empty payload list for no visible
  // reason, while a later one on the same client passes.
  const {
    data: { session },
  } = await client.auth.getSession();
  await client.realtime.setAuth(session.access_token);

  return { id: userId, email, client };
}

console.log("\n— users & profile trigger —");
const anish = await makeUser("anish.e2e@example.com", "Anish Neema");
const nav = await makeUser("nav.e2e@example.com", "Nav Patel");
const sam = await makeUser("sam.e2e@example.com", "Sam Cole");
const nosy = await makeUser("nosy.e2e@example.com", "Nosy Neighbour");

{
  const { data } = await anish.client.from("profiles").select("*").eq("id", anish.id).single();
  check("profile row created from OAuth metadata", data?.display_name === "Anish Neema",
    `got ${data?.display_name}`);
  check("avatar_url carried across", data?.avatar_url?.includes("Anish"));
}

console.log("\n— create room —");
const RUN = `e2e-${Date.now()}`;

const { data: room, error: roomError } = await anish.client.rpc("create_room", {
  p_name: `Apartment 4B ${RUN}`,
  p_kind: "room",
  p_invite_mode: "link",
  p_invite_emails: ["nav.e2e@example.com"],
});
check("create_room succeeded", !roomError && room?.id, roomError?.message);
check("invite_code generated", typeof room?.invite_code === "string" && room.invite_code.length === 16);

console.log("\n— invite link —");
{
  const { data } = await nav.client.rpc("peek_room_by_code", { p_code: room.invite_code });
  check("non-member can peek room name via code", data?.[0]?.name === `Apartment 4B ${RUN}`);

  const { data: rows } = await nav.client.from("rooms").select("*").eq("id", room.id);
  check("non-member cannot select the room directly (RLS)", (rows ?? []).length === 0);

  const { error } = await nav.client.rpc("join_room_with_code", { p_code: room.invite_code });
  check("join via link works", !error, error?.message);

  const { error: samError } = await sam.client.rpc("join_room_with_code", { p_code: room.invite_code });
  check("second roommate joins", !samError, samError?.message);

  const { data: again, error: againError } = await nav.client.rpc("join_room_with_code", {
    p_code: room.invite_code,
  });
  check("re-joining is idempotent", !againError && again === room.id, againError?.message);

  const { data: members } = await anish.client.from("room_members").select("*").eq("room_id", room.id);
  check("roster has exactly 3 members", members?.length === 3, `got ${members?.length}`);
}

console.log("\n— expenses: every split mode —");
const splitCases = [
  {
    label: "equal 3-way of $30.00",
    args: {
      p_description: "Costco run", p_amount_cents: 3000, p_paid_by: anish.id,
      p_split_type: "equal",
      p_splits: [
        { user_id: anish.id, owed_cents: 1000 },
        { user_id: nav.id, owed_cents: 1000 },
        { user_id: sam.id, owed_cents: 1000 },
      ],
    },
  },
  {
    label: "exact 20/15/10 of $45.00",
    args: {
      p_description: "Internet", p_amount_cents: 4500, p_paid_by: nav.id,
      p_split_type: "exact",
      p_splits: [
        { user_id: anish.id, owed_cents: 2000 },
        { user_id: nav.id, owed_cents: 1500 },
        { user_id: sam.id, owed_cents: 1000 },
      ],
    },
  },
  {
    label: "percent 50/30/20 of $10.00",
    args: {
      p_description: "Cleaning supplies", p_amount_cents: 1000, p_paid_by: sam.id,
      p_split_type: "percent",
      p_splits: [
        { user_id: anish.id, owed_cents: 500 },
        { user_id: nav.id, owed_cents: 300 },
        { user_id: sam.id, owed_cents: 200 },
      ],
    },
  },
  {
    label: "personal (unsplit) $7.50",
    args: {
      p_description: "Sam's lunch", p_amount_cents: 750, p_paid_by: sam.id,
      p_split_type: "personal",
      p_splits: [{ user_id: sam.id, owed_cents: 750 }],
    },
  },
  {
    label: "split with one other person only",
    args: {
      p_description: "Concert ticket", p_amount_cents: 6000, p_paid_by: anish.id,
      p_split_type: "equal",
      p_splits: [{ user_id: nav.id, owed_cents: 6000 }],
    },
  },
];

for (const { label, args } of splitCases) {
  const { error } = await anish.client.rpc("create_expense", {
    p_room_id: room.id, p_spent_at: "2026-08-30", p_notes: null, ...args,
  });
  check(label, !error, error?.message);
}

console.log("\n— balances —");
{
  const { data: balances } = await anish.client.rpc("room_balances", { p_room_id: room.id });
  const net = Object.fromEntries((balances ?? []).map((b) => [b.user_id, b.net_cents]));

  // paid:  Anish 3000+6000=9000, Nav 4500, Sam 1000+750=1750
  // owed:  Anish 1000+2000+500=3500, Nav 1000+1500+300+6000=8800, Sam 1000+1000+200+750=2950
  check("Anish net = +5500", net[anish.id] === 5500, `got ${net[anish.id]}`);
  check("Nav net = -4300", net[nav.id] === -4300, `got ${net[nav.id]}`);
  check("Sam net = -1200", net[sam.id] === -1200, `got ${net[sam.id]}`);
  check(
    "balances net to zero",
    (balances ?? []).reduce((s, b) => s + b.net_cents, 0) === 0,
  );
}

console.log("\n— invariant guards through the API —");
{
  const bad = await anish.client.rpc("create_expense", {
    p_room_id: room.id, p_description: "Bad math", p_amount_cents: 3000,
    p_paid_by: anish.id, p_spent_at: "2026-08-30", p_split_type: "exact", p_notes: null,
    p_splits: [{ user_id: anish.id, owed_cents: 2999 }],
  });
  check("splits that don't sum to the total are rejected", Boolean(bad.error),
    bad.error?.message);
  check("rejection message names both figures",
    bad.error?.message?.includes("29.99") && bad.error?.message?.includes("30.00"),
    bad.error?.message);

  const outsider = await anish.client.rpc("create_expense", {
    p_room_id: room.id, p_description: "Outsider", p_amount_cents: 100,
    p_paid_by: anish.id, p_spent_at: "2026-08-30", p_split_type: "equal", p_notes: null,
    p_splits: [{ user_id: nosy.id, owed_cents: 100 }],
  });
  check("non-members can't appear in a split", Boolean(outsider.error));

  const direct = await anish.client.from("expense_splits").insert({
    expense_id: "00000000-0000-0000-0000-000000000000",
    room_id: room.id, user_id: anish.id, owed_cents: 1,
  });
  check("expense_splits is not directly writable", Boolean(direct.error));

  const sneaky = await anish.client.from("rooms").insert({ name: "Sneaky", created_by: anish.id });
  check("rooms can't be inserted outside create_room()", Boolean(sneaky.error));
}

console.log("\n— a charge belongs to whoever entered it —");
{
  // A personal split, so the scratch charge can't disturb anyone else's
  // balance assertions if a check below fails before it is cleaned up.
  const { data: id, error } = await anish.client.rpc("create_expense", {
    p_room_id: room.id, p_description: "Authorship scratch", p_amount_cents: 500,
    p_paid_by: anish.id, p_spent_at: "2026-08-30", p_split_type: "personal",
    p_notes: null, p_splits: [{ user_id: anish.id, owed_cents: 500 }],
  });
  check("the author can add a charge", !error && Boolean(id), error?.message);

  // A failing USING clause on DELETE is not an error -- it matches no rows. So
  // .select() is required, otherwise `data` is null and nothing is being counted.
  const theft = await nav.client.from("expenses").delete().eq("id", id).select();
  check("a non-author cannot delete a charge",
    Boolean(theft.error) || (theft.data ?? []).length === 0,
    `deleted ${theft.data?.length} row(s)`);

  const { data: survivors } = await nav.client.from("expenses").select("id").eq("id", id);
  check("the charge is still there afterwards", (survivors ?? []).length === 1);

  const edit = await nav.client.rpc("update_expense", {
    p_expense_id: id, p_description: "Hijacked", p_amount_cents: 500,
    p_paid_by: nav.id, p_spent_at: "2026-08-30", p_split_type: "personal",
    p_notes: null, p_splits: [{ user_id: nav.id, owed_cents: 500 }],
  });
  check("a non-author cannot edit a charge", Boolean(edit.error), edit.error?.message);
  check("the refusal explains why",
    edit.error?.message?.includes("who added this charge"), edit.error?.message);

  const own = await anish.client.rpc("update_expense", {
    p_expense_id: id, p_description: "Authorship scratch (edited)", p_amount_cents: 600,
    p_paid_by: anish.id, p_spent_at: "2026-08-30", p_split_type: "personal",
    p_notes: null, p_splits: [{ user_id: anish.id, owed_cents: 600 }],
  });
  check("the author can edit their own charge", !own.error, own.error?.message);

  const gone = await anish.client.from("expenses").delete().eq("id", id).select();
  check("the author can delete their own charge",
    !gone.error && (gone.data ?? []).length === 1, gone.error?.message);

  const { data: orphans } = await anish.client.from("expense_splits")
    .select("id").eq("expense_id", id);
  check("its splits cascade away with it", (orphans ?? []).length === 0);
}

console.log("\n— settle up —");
{
  const { error } = await nav.client.from("settlements").insert({
    room_id: room.id, from_user: nav.id, to_user: anish.id,
    amount_cents: 4300, created_by: nav.id,
  });
  check("recording a payment works", !error, error?.message);

  const { data: balances } = await nav.client.rpc("room_balances", { p_room_id: room.id });
  const net = Object.fromEntries((balances ?? []).map((b) => [b.user_id, b.net_cents]));
  check("Nav is now square", net[nav.id] === 0, `got ${net[nav.id]}`);
  check("Anish drops to +1200", net[anish.id] === 1200, `got ${net[anish.id]}`);

  const forged = await nav.client.from("settlements").insert({
    room_id: room.id, from_user: nav.id, to_user: nosy.id,
    amount_cents: 100, created_by: nav.id,
  });
  check("can't record a payment to a non-member", Boolean(forged.error));

  const spoofed = await nav.client.from("settlements").insert({
    room_id: room.id, from_user: nav.id, to_user: anish.id,
    amount_cents: 100, created_by: sam.id,
  });
  check("can't attribute a payment to someone else", Boolean(spoofed.error));
}

console.log("\n— chores —");
let choreId;
{
  const { data, error } = await anish.client.from("chores").insert({
    room_id: room.id, title: "Take out trash", assigned_to: nav.id,
    due_date: "2026-08-31", created_by: anish.id,
  }).select().single();
  check("creating a chore works", !error && data?.id, error?.message);
  choreId = data?.id;

  const { data: toggled } = await nav.client.from("chores")
    .update({ done: true }).eq("id", choreId).select().single();
  check("completion is attributed to the person who ticked it",
    toggled?.done_by === nav.id, `got ${toggled?.done_by}`);
  check("done_at stamped by the database", Boolean(toggled?.done_at));

  const { data: untoggled } = await nav.client.from("chores")
    .update({ done: false }).eq("id", choreId).select().single();
  check("un-ticking clears the stamps",
    untoggled?.done_by === null && untoggled?.done_at === null);

  const assignOutsider = await anish.client.from("chores")
    .update({ assigned_to: nosy.id }).eq("id", choreId).select();
  check("can't assign a chore to a non-member",
    Boolean(assignOutsider.error) || (assignOutsider.data ?? []).length === 0);
}

console.log("\n— shopping list —");
{
  const { data: item, error } = await anish.client.from("shopping_items").insert({
    room_id: room.id, name: "Oat milk", quantity: "2 cartons", requested_by: anish.id,
    for_users: [anish.id],
  }).select().single();
  check("adding an item works", !error && Boolean(item?.id), error?.message);
  check("a new item starts unclaimed and unbought",
    item?.assigned_to === null && item?.bought === false);

  const spoofed = await nav.client.from("shopping_items").insert({
    room_id: room.id, name: "Not mine to ask for", requested_by: anish.id,
    for_users: [anish.id],
  });
  check("can't add an item in someone else's name", Boolean(spoofed.error));

  const rename = await nav.client.from("shopping_items")
    .update({ name: "Almond milk" }).eq("id", item.id).select();
  check("a non-requester cannot change what an item is", Boolean(rename.error),
    rename.error?.message);

  const claim = await nav.client.from("shopping_items")
    .update({ assigned_to: nav.id }).eq("id", item.id).select().single();
  check("anyone in the room can claim an item", claim.data?.assigned_to === nav.id,
    claim.error?.message);

  const unclaim = await nav.client.from("shopping_items")
    .update({ assigned_to: null }).eq("id", item.id).select().single();
  check("and can put it back down", unclaim.data?.assigned_to === null,
    unclaim.error?.message);

  const handOff = await sam.client.from("shopping_items")
    .update({ assigned_to: nav.id }).eq("id", item.id).select();
  check("but cannot hand an item they don't hold to a third person",
    Boolean(handOff.error), handOff.error?.message);

  const bought = await nav.client.from("shopping_items")
    .update({ bought: true }).eq("id", item.id).select().single();
  check("anyone can tick an item off", bought.data?.bought === true, bought.error?.message);
  check("the purchase is attributed to whoever ticked it",
    bought.data?.bought_by === nav.id, `got ${bought.data?.bought_by}`);
  check("bought_at is stamped by the database", Boolean(bought.data?.bought_at));

  const forged = await nav.client.from("shopping_items")
    .update({ bought: false }).eq("id", item.id).select().single();
  check("un-ticking clears the stamps",
    forged.data?.bought_by === null && forged.data?.bought_at === null);

  const theft = await nav.client.from("shopping_items")
    .delete().eq("id", item.id).select();
  check("a non-requester cannot delete an item",
    Boolean(theft.error) || (theft.data ?? []).length === 0,
    `deleted ${theft.data?.length} row(s)`);

  const owner = await anish.client.from("shopping_items")
    .update({ name: "Oat milk (barista)", quantity: "1 carton", assigned_to: sam.id })
    .eq("id", item.id).select().single();
  check("the requester can rename, re-size and re-assign their own item",
    owner.data?.name === "Oat milk (barista)" && owner.data?.assigned_to === sam.id,
    owner.error?.message);

  const toOutsider = await anish.client.from("shopping_items")
    .update({ assigned_to: nosy.id }).eq("id", item.id).select();
  check("an item can't be assigned to a non-member",
    Boolean(toOutsider.error) || (toOutsider.data ?? []).length === 0);

  const removed = await anish.client.from("shopping_items")
    .delete().eq("id", item.id).select();
  check("the requester can delete their own item",
    !removed.error && (removed.data ?? []).length === 1, removed.error?.message);
}

console.log("\n— my_rooms summary —");
{
  const { data } = await nav.client.rpc("my_rooms");
  const apartment = (data ?? []).find((r) => r.name === `Apartment 4B ${RUN}`);
  check("my_rooms lists the room", Boolean(apartment));
  check("member_count is 3", apartment?.member_count === 3, `got ${apartment?.member_count}`);
  check("my_net_cents matches room_balances", apartment?.my_net_cents === 0,
    `got ${apartment?.my_net_cents}`);
  check("open_chore_count is 1", apartment?.open_chore_count === 1,
    `got ${apartment?.open_chore_count}`);

  const { data: nothing } = await nosy.client.rpc("my_rooms");
  check("outsider sees no rooms", (nothing ?? []).length === 0);
}

console.log("\n— charging a shopping trip —");
{
  const { data: rows, error } = await anish.client.from("shopping_items").insert([
    { room_id: room.id, name: `Oat milk ${RUN}`, requested_by: anish.id,
      for_users: [anish.id] },
    { room_id: room.id, name: `Paper towels ${RUN}`, requested_by: anish.id,
      for_users: [anish.id, nav.id, sam.id] },
  ]).select();
  check("adding items for one person and for the house works",
    !error && (rows ?? []).length === 2, error?.message);

  const milk = rows.find((r) => r.name.startsWith("Oat milk"));
  const towels = rows.find((r) => r.name.startsWith("Paper towels"));

  const badFor = await anish.client.from("shopping_items").insert({
    room_id: room.id, name: "For an outsider", requested_by: anish.id,
    for_users: [nosy.id],
  });
  check("an item can't be for a non-member", Boolean(badFor.error));

  const emptyFor = await anish.client.from("shopping_items").insert({
    room_id: room.id, name: "For nobody", requested_by: anish.id, for_users: [],
  });
  check("an item must be for at least one person", Boolean(emptyFor.error));

  const reaim = await nav.client.from("shopping_items")
    .update({ for_users: [nav.id] }).eq("id", milk.id).select();
  check("a non-requester cannot change who an item is for",
    Boolean(reaim.error), reaim.error?.message);

  // Neither column is in the UPDATE grant, so PostgREST is refused outright.
  const forgePrice = await anish.client.from("shopping_items")
    .update({ price_cents: 1 }).eq("id", milk.id).select();
  check("price_cents is not client-writable", Boolean(forgePrice.error),
    forgePrice.error?.message);
  const forgeLink = await anish.client.from("shopping_items")
    .update({ expense_id: null }).eq("id", milk.id).select();
  check("expense_id is not client-writable", Boolean(forgeLink.error),
    forgeLink.error?.message);

  // Nav does the shop.
  await nav.client.from("shopping_items")
    .update({ bought: true }).in("id", [milk.id, towels.id]);

  const tooEarly = await nav.client.rpc("charge_shopping_items", {
    p_room_id: room.id, p_description: "Nothing bought", p_spent_at: "2026-08-30",
    p_lines: [{ item_id: milk.id, price_cents: 0 }],
  });
  check("a line needs a price above $0", Boolean(tooEarly.error), tooEarly.error?.message);

  const notMine = await anish.client.rpc("charge_shopping_items", {
    p_room_id: room.id, p_description: "Not my shop", p_spent_at: "2026-08-30",
    p_lines: [{ item_id: milk.id, price_cents: 420 }],
  });
  check("you can't charge a purchase you didn't make", Boolean(notMine.error),
    notMine.error?.message);

  // $4.20 of oat milk for Anish; $9.20 of towels three ways -> 307/307/306.
  const { data: expenseId, error: chargeError } = await nav.client
    .rpc("charge_shopping_items", {
      p_room_id: room.id, p_description: "Weekly shop", p_spent_at: "2026-08-30",
      p_lines: [
        { item_id: milk.id, price_cents: 420 },
        { item_id: towels.id, price_cents: 920 },
      ],
    });
  check("charging the trip works", !chargeError && Boolean(expenseId),
    chargeError?.message);

  const { data: expense } = await nav.client.from("expenses")
    .select("*").eq("id", expenseId).single();
  check("the charge totals the lines", expense?.amount_cents === 1340,
    `got ${expense?.amount_cents}`);
  check("paid by whoever bought them", expense?.paid_by === nav.id);
  check("and authored by them, so it's theirs to correct",
    expense?.created_by === nav.id);
  check("recorded as an exact split", expense?.split_type === "exact");
  check("the note lists what was bought",
    expense?.notes?.includes("Oat milk") && expense?.notes?.includes("Paper towels"),
    expense?.notes);

  const { data: splits } = await nav.client.from("expense_splits")
    .select("*").eq("expense_id", expenseId);
  const owed = Object.fromEntries((splits ?? []).map((x) => [x.user_id, x.owed_cents]));
  check("Anish owes his oat milk plus a third of the towels",
    owed[anish.id] === 727, `got ${owed[anish.id]}`);
  check("Nav owes his third of the towels", owed[nav.id] === 307, `got ${owed[nav.id]}`);
  check("Sam gets the odd penny", owed[sam.id] === 306, `got ${owed[sam.id]}`);
  check("the splits add up to the trip total exactly",
    (splits ?? []).reduce((sum, x) => sum + x.owed_cents, 0) === 1340);

  const { data: linked } = await nav.client.from("shopping_items")
    .select("*").in("id", [milk.id, towels.id]);
  check("both items now point at the charge",
    (linked ?? []).length === 2 && linked.every((i) => i.expense_id === expenseId));
  check("and remember what they cost",
    linked?.find((i) => i.id === milk.id)?.price_cents === 420);

  const again = await nav.client.rpc("charge_shopping_items", {
    p_room_id: room.id, p_description: "Again", p_spent_at: "2026-08-30",
    p_lines: [{ item_id: milk.id, price_cents: 420 }],
  });
  check("an item already on a charge can't be charged again", Boolean(again.error),
    again.error?.message);

  const untick = await nav.client.from("shopping_items")
    .update({ bought: false }).eq("id", milk.id).select();
  check("a charged item can't be un-ticked",
    Boolean(untick.error) || (untick.data ?? []).length === 0, untick.error?.message);

  // Deleting the charge hands the items back, price remembered.
  await nav.client.from("expenses").delete().eq("id", expenseId);
  const { data: returned } = await nav.client.from("shopping_items")
    .select("*").in("id", [milk.id, towels.id]);
  check("deleting the charge returns its items to the queue",
    (returned ?? []).every((i) => i.expense_id === null && i.bought));
  check("with the price still remembered",
    returned?.find((i) => i.id === milk.id)?.price_cents === 420);

  await anish.client.from("shopping_items").delete().in("id", [milk.id, towels.id]);

  // Buying for yourself and someone else must bill only the someone else. Your
  // own share cancels against what you paid; it is not a debt to yourself.
  const before = Object.fromEntries(
    ((await nav.client.rpc("room_balances", { p_room_id: room.id })).data ?? [])
      .map((b) => [b.user_id, b.net_cents]),
  );

  const { data: shared } = await nav.client.from("shopping_items").insert({
    room_id: room.id, name: `Shared razors ${RUN}`, requested_by: nav.id,
    for_users: [nav.id, anish.id],
  }).select().single();
  await nav.client.from("shopping_items").update({ bought: true }).eq("id", shared.id);
  const { data: sharedCharge } = await nav.client.rpc("charge_shopping_items", {
    p_room_id: room.id, p_description: "Shared razors", p_spent_at: "2026-08-30",
    p_lines: [{ item_id: shared.id, price_cents: 7000 }],
  });

  const after = Object.fromEntries(
    ((await nav.client.rpc("room_balances", { p_room_id: room.id })).data ?? [])
      .map((b) => [b.user_id, b.net_cents]),
  );
  check("buying for yourself and someone else only bills the someone else",
    after[nav.id] - before[nav.id] === 3500,
    `Nav moved by ${after[nav.id] - before[nav.id]}, expected 3500`);
  check("the other person owes just their own share",
    before[anish.id] - after[anish.id] === 3500,
    `Anish moved by ${before[anish.id] - after[anish.id]}`);

  // Entirely your own: logged, but a personal expense that moves nobody.
  const { data: solo } = await nav.client.from("shopping_items").insert({
    room_id: room.id, name: `Own shampoo ${RUN}`, requested_by: nav.id,
    for_users: [nav.id],
  }).select().single();
  await nav.client.from("shopping_items").update({ bought: true }).eq("id", solo.id);
  const { data: soloCharge } = await nav.client.rpc("charge_shopping_items", {
    p_room_id: room.id, p_description: "Own shampoo", p_spent_at: "2026-08-30",
    p_lines: [{ item_id: solo.id, price_cents: 1000 }],
  });

  const { data: soloExpense } = await nav.client.from("expenses")
    .select("*").eq("id", soloCharge).single();
  check("a trip only for yourself is recorded as personal, not a one-way split",
    soloExpense?.split_type === "personal", `got ${soloExpense?.split_type}`);

  const afterSolo = Object.fromEntries(
    ((await nav.client.rpc("room_balances", { p_room_id: room.id })).data ?? [])
      .map((b) => [b.user_id, b.net_cents]),
  );
  check("spending on yourself moves nobody's balance",
    afterSolo[nav.id] === after[nav.id] && afterSolo[anish.id] === after[anish.id],
    `Nav moved by ${afterSolo[nav.id] - after[nav.id]}`);

  await nav.client.from("expenses").delete().in("id", [sharedCharge, soloCharge]);
  await nav.client.from("shopping_items").delete().in("id", [shared.id, solo.id]);
}

console.log("\n— RLS isolation for a signed-in non-member —");
for (const table of ["expenses", "expense_splits", "settlements", "chores",
                     "shopping_items", "room_members"]) {
  const { data } = await nosy.client.from(table).select("*");
  check(`outsider reads 0 rows from ${table}`, (data ?? []).length === 0,
    `got ${data?.length}`);
}
{
  const { data } = await nosy.client.rpc("room_balances", { p_room_id: room.id });
  check("outsider gets empty balances", (data ?? []).length === 0);
}

console.log("\n— allowlist invite mode —");
{
  const { data: trip } = await anish.client.rpc("create_room", {
    p_name: `Miami trip ${RUN}`, p_kind: "trip", p_invite_mode: "allowlist",
    p_invite_emails: ["nav.e2e@example.com"],
  });

  const refused = await nosy.client.rpc("join_room_with_code", { p_code: trip.invite_code });
  check("uninvited email is refused", Boolean(refused.error));
  check("refusal explains why",
    refused.error?.message?.includes("invited email"), refused.error?.message);

  const allowed = await nav.client.rpc("join_room_with_code", { p_code: trip.invite_code });
  check("invited email gets in", !allowed.error, allowed.error?.message);

  const { data: invites } = await anish.client.from("room_invites")
    .select("*").eq("room_id", trip.id);
  check("invite is stamped accepted", Boolean(invites?.[0]?.accepted_at));
}

console.log("\n— realtime —");
{
  // Nav subscribes; Anish writes; the event must arrive with RLS applied.
  const received = [];
  const channel = nav.client.channel(`room:${room.id}`);
  const subscribed = new Promise((resolve, reject) => {
    channel
      .on("postgres_changes",
        { event: "*", schema: "public", table: "chores", filter: `room_id=eq.${room.id}` },
        (payload) => received.push(payload))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
      });
  });

  try {
    await subscribed;
    check("realtime channel subscribes", true);

    const rtInsert = await anish.client.from("chores").insert({
      room_id: room.id, title: "Vacuum living room", created_by: anish.id,
    });
    console.log("    [debug] insert error:", rtInsert.error?.message ?? "none");
    const rtUpdate = await anish.client.from("chores")
      .update({ done: true }).eq("id", choreId).select();
    console.log("    [debug] update error:", rtUpdate.error?.message ?? "none",
      "rows:", rtUpdate.data?.length);
    console.log("    [debug] channel state:", channel.state);

    const deadline = Date.now() + 8000;
    while (received.length < 2 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }

    check("INSERT reached the other roommate",
      received.some((p) => p.eventType === "INSERT" && p.new?.title === "Vacuum living room"),
      JSON.stringify(received.map((p) => p.eventType)));
    check("UPDATE reached the other roommate",
      received.some((p) => p.eventType === "UPDATE" && p.new?.done === true));
  } catch (e) {
    check("realtime channel subscribes", false, e.message);
  } finally {
    await nav.client.removeChannel(channel);
  }

  // An outsider must not receive events for a room they aren't in.
  const leaked = [];
  const nosyChannel = nosy.client.channel(`nosy:${room.id}`);
  await new Promise((resolve) => {
    nosyChannel
      .on("postgres_changes",
        { event: "*", schema: "public", table: "chores", filter: `room_id=eq.${room.id}` },
        (p) => leaked.push(p))
      .subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          resolve();
        }
      });
  });
  await anish.client.from("chores").insert({
    room_id: room.id, title: "Secret chore", created_by: anish.id,
  });
  await new Promise((r) => setTimeout(r, 2500));
  check("realtime does not leak to a non-member", leaked.length === 0,
    `received ${leaked.length} events`);
  await nosy.client.removeChannel(nosyChannel);
}

console.log("\n— realtime for the shopping list —");
{
  // Its own block: a new table only reaches Realtime if the migration added it
  // to the supabase_realtime publication, and nothing else here would catch a
  // missing ALTER PUBLICATION.
  const received = [];
  const channel = nav.client.channel(`shopping:${room.id}`);
  const subscribed = new Promise((resolve, reject) => {
    channel
      .on("postgres_changes",
        { event: "*", schema: "public", table: "shopping_items",
          filter: `room_id=eq.${room.id}` },
        (payload) => received.push(payload))
      .subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
      });
  });

  try {
    await subscribed;
    const rt = await anish.client.from("shopping_items").insert({
      room_id: room.id, name: "Bin bags", requested_by: anish.id,
      for_users: [anish.id],
    });
    console.log("    [debug] insert error:", rt.error?.message ?? "none");
    console.log("    [debug] channel state:", channel.state);

    const deadline = Date.now() + 8000;
    while (received.length < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    check("a new shopping item reaches the other roommate",
      received.some((p) => p.eventType === "INSERT" && p.new?.name === "Bin bags"),
      JSON.stringify(received.map((p) => p.eventType)));
  } catch (e) {
    check("shopping list realtime channel subscribes", false, e.message);
  } finally {
    await nav.client.removeChannel(channel);
  }
}

console.log(`\n${"=".repeat(60)}`);
if (failures.length === 0) {
  console.log(`ALL ${passed} END-TO-END CHECKS PASSED`);
} else {
  console.log(`${passed} passed, ${failures.length} FAILED:`);
  for (const f of failures) console.log(`  - ${f}`);
}
console.log("=".repeat(60));
process.exit(failures.length === 0 ? 0 : 1);
