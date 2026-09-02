"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireRoomContext, requireUser } from "@/lib/dal";
import type { InviteMode, RoomKind } from "@/lib/types/database";

/**
 * Room-level mutations run as Server Actions because each one either navigates
 * afterwards or changes server-rendered chrome. Writes inside a room (expenses,
 * chores) instead go through the browser client, so the acting user is updated
 * by the same Realtime event as everyone else.
 */

export type ActionResult = { ok: true } | { ok: false; error: string };

const emailList = z
  .string()
  .optional()
  .transform((raw) =>
    (raw ?? "")
      .split(/[,\s;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
  .refine((emails) => emails.every((e) => /^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(e)), {
    message: "One of those email addresses doesn't look right.",
  });

const createRoomSchema = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(80, "That name is too long."),
  kind: z.enum(["room", "trip"]),
  inviteMode: z.enum(["link", "allowlist"]),
  emails: emailList,
});

export async function createRoomAction(formData: FormData) {
  await requireUser();

  const parsed = createRoomSchema.safeParse({
    name: formData.get("name"),
    kind: formData.get("kind"),
    inviteMode: formData.get("inviteMode"),
    emails: formData.get("emails"),
  });

  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0].message };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_room", {
    p_name: parsed.data.name,
    p_kind: parsed.data.kind as RoomKind,
    p_invite_mode: parsed.data.inviteMode as InviteMode,
    p_invite_emails: parsed.data.emails,
  });

  if (error || !data) {
    return { ok: false as const, error: error?.message ?? "Could not create that room." };
  }

  redirect(`/rooms/${data.id}`);
}

const renameSchema = z.object({
  roomId: z.string().uuid(),
  name: z.string().trim().min(1, "Give it a name.").max(80),
  inviteMode: z.enum(["link", "allowlist"]),
});

export async function updateRoomAction(formData: FormData): Promise<ActionResult> {
  const parsed = renameSchema.safeParse({
    roomId: formData.get("roomId"),
    name: formData.get("name"),
    inviteMode: formData.get("inviteMode"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const { isOwner } = await requireRoomContext(parsed.data.roomId);
  if (!isOwner) return { ok: false, error: "Only the room owner can change these." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase
    .from("rooms")
    .update({ name: parsed.data.name, invite_mode: parsed.data.inviteMode })
    .eq("id", parsed.data.roomId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/rooms/${parsed.data.roomId}`, "layout");
  return { ok: true };
}

export async function addInviteAction(formData: FormData): Promise<ActionResult> {
  const roomId = String(formData.get("roomId") ?? "");
  const parsed = emailList.safeParse(String(formData.get("emails") ?? ""));

  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  if (parsed.data.length === 0) return { ok: false, error: "Enter at least one email." };

  const { me } = await requireRoomContext(roomId);
  const supabase = await createSupabaseServerClient();

  const { error } = await supabase.from("room_invites").upsert(
    parsed.data.map((email) => ({ room_id: roomId, email, created_by: me.id })),
    { onConflict: "room_id,email", ignoreDuplicates: true },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/rooms/${roomId}/settings`);
  return { ok: true };
}

export async function removeInviteAction(formData: FormData): Promise<ActionResult> {
  const roomId = String(formData.get("roomId") ?? "");
  const inviteId = String(formData.get("inviteId") ?? "");

  await requireRoomContext(roomId);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("room_invites").delete().eq("id", inviteId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/rooms/${roomId}/settings`);
  return { ok: true };
}

export async function removeMemberAction(formData: FormData): Promise<ActionResult> {
  const roomId = String(formData.get("roomId") ?? "");
  const userId = String(formData.get("userId") ?? "");

  const { isOwner, me, members } = await requireRoomContext(roomId);
  if (!isOwner && userId !== me.id) {
    return { ok: false, error: "Only the room owner can remove someone else." };
  }
  if (members.length === 1) {
    return { ok: false, error: "You're the last member — delete the room instead." };
  }

  // Removing someone with a non-zero balance would silently drop their debt
  // from every other person's total, so make them settle first.
  const supabase = await createSupabaseServerClient();
  const { data: balances } = await supabase.rpc("room_balances", { p_room_id: roomId });
  const theirs = (balances ?? []).find((b) => b.user_id === userId);
  if (theirs && theirs.net_cents !== 0) {
    return {
      ok: false,
      error:
        "That person still has an unsettled balance. Settle up on the Balances tab first.",
    };
  }

  const { error } = await supabase
    .from("room_members")
    .delete()
    .eq("room_id", roomId)
    .eq("user_id", userId);

  if (error) return { ok: false, error: error.message };

  if (userId === me.id) redirect("/");

  revalidatePath(`/rooms/${roomId}`, "layout");
  return { ok: true };
}

export async function deleteRoomAction(formData: FormData): Promise<ActionResult> {
  const roomId = String(formData.get("roomId") ?? "");
  const { isOwner } = await requireRoomContext(roomId);
  if (!isOwner) return { ok: false, error: "Only the room owner can delete it." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("rooms").delete().eq("id", roomId);
  if (error) return { ok: false, error: error.message };

  redirect("/");
}

export async function joinRoomAction(code: string) {
  await requireUser(`/join/${code}`);
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.rpc("join_room_with_code", { p_code: code });
  if (error) return { ok: false as const, error: error.message };

  redirect(`/rooms/${data}`);
}
