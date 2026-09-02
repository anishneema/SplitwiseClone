/**
 * Seeds a known scenario into a freshly reset local database, so the UI smoke
 * test can assert on exact figures.
 *
 *   npx supabase db reset && node supabase/_localtest/seed-ui.mjs
 *
 * The two expenses are deliberately entered by different people -- "Costco run"
 * by Anish, "Internet bill" by Nav -- so that signing in as either one shows a
 * charge they may edit next to one they may only look at.
 *
 * The shopping list leaves both Anish and Nav holding a bought-but-unpriced
 * trip, so the "add prices" bar is there to try as either of them.
 */
import { createClient } from "@supabase/supabase-js";

const API = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
// Default to the standard local Supabase demo keys, which are identical on
// every `supabase start` install and are not secrets. Override via env to
// point these scripts at another stack.
const ANON = process.env.SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const admin = createClient(API, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function user(email, fullName) {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  let id = list?.users.find((u) => u.email === email)?.id;
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: "test-password-123",
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw error;
    id = data.user.id;
  }
  const client = createClient(API, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: "test-password-123",
  });
  if (error) throw error;
  return { id, client };
}

/** Local calendar date, not UTC -- otherwise evening seeds land on "tomorrow". */
function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const anish = await user("anish.e2e@example.com", "Anish Neema");
const nav = await user("nav.e2e@example.com", "Nav Patel");
const sam = await user("sam.e2e@example.com", "Sam Cole");

const { data: room, error } = await anish.client.rpc("create_room", {
  p_name: "Apartment 4B",
  p_kind: "room",
  p_invite_mode: "link",
  p_invite_emails: [],
});
if (error) throw error;

await nav.client.rpc("join_room_with_code", { p_code: room.invite_code });
await sam.client.rpc("join_room_with_code", { p_code: room.invite_code });

// Anish pays $30 for groceries, split three ways.
await anish.client.rpc("create_expense", {
  p_room_id: room.id,
  p_description: "Costco run",
  p_amount_cents: 3000,
  p_paid_by: anish.id,
  p_spent_at: localDate(),
  p_split_type: "equal",
  p_notes: null,
  p_splits: [
    { user_id: anish.id, owed_cents: 1000 },
    { user_id: nav.id, owed_cents: 1000 },
    { user_id: sam.id, owed_cents: 1000 },
  ],
});

// Nav pays the $45 internet bill, uneven exact shares.
await nav.client.rpc("create_expense", {
  p_room_id: room.id,
  p_description: "Internet bill",
  p_amount_cents: 4500,
  p_paid_by: nav.id,
  p_spent_at: localDate(-1),
  p_split_type: "exact",
  p_notes: null,
  p_splits: [
    { user_id: anish.id, owed_cents: 2000 },
    { user_id: nav.id, owed_cents: 1500 },
    { user_id: sam.id, owed_cents: 1000 },
  ],
});

// One settled payment, so the Payments list has something in it.
await sam.client.from("settlements").insert({
  room_id: room.id,
  from_user: sam.id,
  to_user: anish.id,
  amount_cents: 500,
  // Always send an explicit local date. The column defaults to current_date,
  // which is the *database's* date (UTC), so an evening entry in the US would
  // otherwise be stamped tomorrow.
  settled_at: localDate(),
  note: "Venmo",
  created_by: sam.id,
});

await anish.client.from("chores").insert([
  {
    room_id: room.id,
    title: "Take out trash",
    assigned_to: nav.id,
    due_date: localDate(-1),
    created_by: anish.id,
  },
  {
    room_id: room.id,
    title: "Buy dish soap",
    assigned_to: null,
    created_by: anish.id,
  },
]);

// Shopping list. Both requested_by and for_users are checked against the
// caller's own JWT by the insert policy, so each item goes in through its own
// requester's client.
//
// Arranged so that signing in as either Anish or Nav shows a trip waiting to be
// priced, plus one already-charged item and one still up for grabs.
const { data: list } = await anish.client
  .from("shopping_items")
  .insert([
    {
      room_id: room.id,
      name: "Oat milk",
      quantity: "2 cartons",
      requested_by: anish.id,
      for_users: [anish.id],
    },
    {
      room_id: room.id,
      name: "Paper towels",
      requested_by: anish.id,
      for_users: [anish.id, nav.id, sam.id],
      assigned_to: nav.id,
    },
  ])
  .select();

const { data: samItems } = await sam.client
  .from("shopping_items")
  .insert([
    {
      room_id: room.id,
      name: "Dish soap",
      quantity: "the green one",
      requested_by: sam.id,
      for_users: [sam.id],
    },
    {
      room_id: room.id,
      name: "Bin bags",
      requested_by: sam.id,
      for_users: [anish.id, nav.id, sam.id],
    },
  ])
  .select();

const { data: navItems } = await nav.client
  .from("shopping_items")
  .insert({
    room_id: room.id,
    name: "Coffee filters",
    requested_by: nav.id,
    for_users: [anish.id, nav.id, sam.id],
  })
  .select();

const byName = Object.fromEntries(
  [...(list ?? []), ...(samItems ?? []), ...(navItems ?? [])].map((i) => [i.name, i.id]),
);

// Nav's shop: he picks up Sam's dish soap and the coffee filters. bought_by is
// stamped from his JWT by the trigger, not sent from here.
await nav.client
  .from("shopping_items")
  .update({ bought: true })
  .in("id", [byName["Dish soap"], byName["Coffee filters"]]);

// Anish grabs the bin bags on his way home, leaving him a trip to price too.
await anish.client
  .from("shopping_items")
  .update({ bought: true })
  .eq("id", byName["Bin bags"]);

// Nav prices one of his two, so the list has a charged item on it and the
// Expenses tab has a charge that came from the shopping list.
const { error: chargeError } = await nav.client.rpc("charge_shopping_items", {
  p_room_id: room.id,
  p_description: "Coffee filters",
  p_spent_at: localDate(),
  p_lines: [{ item_id: byName["Coffee filters"], price_cents: 450 }],
});
if (chargeError) throw chargeError;

const { data: balances } = await anish.client.rpc("room_balances", {
  p_room_id: room.id,
});

console.log(JSON.stringify({
  roomId: room.id,
  inviteCode: room.invite_code,
  users: { anish: anish.id, nav: nav.id, sam: sam.id },
  balances,
}, null, 2));
