/**
 * Hand-maintained mirror of supabase/migrations/20260830000000_init.sql.
 *
 * Once the Supabase project exists you can regenerate this instead:
 *   npx supabase login
 *   npx supabase gen types typescript --project-id <ref> > src/lib/types/database.ts
 */

export type RoomKind = "room" | "trip";
export type InviteMode = "link" | "allowlist";
export type SplitType = "equal" | "exact" | "percent" | "personal";
export type MemberRole = "owner" | "member";

export type Profile = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
};

export type Room = {
  id: string;
  name: string;
  kind: RoomKind;
  invite_code: string;
  invite_mode: InviteMode;
  created_by: string;
  created_at: string;
};

export type RoomMember = {
  room_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
};

export type RoomInvite = {
  id: string;
  room_id: string;
  email: string;
  created_by: string;
  created_at: string;
  accepted_at: string | null;
};

export type Expense = {
  id: string;
  room_id: string;
  description: string;
  amount_cents: number;
  paid_by: string;
  spent_at: string;
  split_type: SplitType;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ExpenseSplit = {
  id: string;
  expense_id: string;
  room_id: string;
  user_id: string;
  owed_cents: number;
};

export type Settlement = {
  id: string;
  room_id: string;
  from_user: string;
  to_user: string;
  amount_cents: number;
  settled_at: string;
  note: string | null;
  created_by: string;
  created_at: string;
};

export type Chore = {
  id: string;
  room_id: string;
  title: string;
  notes: string | null;
  assigned_to: string | null;
  due_date: string | null;
  done: boolean;
  done_at: string | null;
  done_by: string | null;
  position: number;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ShoppingItem = {
  id: string;
  room_id: string;
  name: string;
  /** Free text — "2 boxes", "whatever's cheapest" — never a number. */
  quantity: string | null;
  notes: string | null;
  /** Who asked for it. The authorship column the RLS policies key on. */
  requested_by: string;
  /**
   * Who the item is for, and therefore who gets charged for it — chosen when
   * the item is requested, so the split is already settled by the time anyone
   * buys it. Always at least one person.
   */
  for_users: string[];
  /** Who agreed to buy it. Null means anyone can. */
  assigned_to: string | null;
  bought: boolean;
  bought_at: string | null;
  bought_by: string | null;
  /** What it cost. Written only by charge_shopping_items(). */
  price_cents: number | null;
  /** The charge this ended up on, if any. Written only by that same RPC. */
  expense_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
};

/** One line of charge_shopping_items(): an item and what it cost. */
export type ChargeLine = { item_id: string; price_cents: number };

/**
 * The columns a client may change on a shopping item. Mirrors the UPDATE column
 * grant in 20260901000200 — price_cents and expense_id belong to
 * charge_shopping_items(), and the stamps belong to the trigger.
 */
export type ShoppingItemPatch = Partial<
  Pick<
    ShoppingItem,
    "name" | "quantity" | "notes" | "assigned_to" | "for_users" | "bought" | "position"
  >
>;

export type RoomBalanceRow = {
  user_id: string;
  paid_cents: number;
  owed_cents: number;
  net_cents: number;
};

/** One row of my_rooms(): a room plus the viewer's standing in it. */
export type RoomSummaryRow = Room & {
  member_count: number;
  my_net_cents: number;
  open_chore_count: number;
  last_activity_at: string;
};

/** The `{ user_id, owed_cents }` shape the expense RPCs expect. */
export type SplitInput = { user_id: string; owed_cents: number };

type Table<Row, Insert = Row, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile, Omit<Profile, "created_at">>;
      rooms: Table<Room>;
      room_members: Table<RoomMember, Omit<RoomMember, "joined_at" | "role"> & { role?: MemberRole }>;
      room_invites: Table<
        RoomInvite,
        Omit<RoomInvite, "id" | "created_at" | "accepted_at">
      >;
      expenses: Table<Expense>;
      expense_splits: Table<ExpenseSplit>;
      settlements: Table<
        Settlement,
        Omit<Settlement, "id" | "created_at" | "settled_at" | "note"> & {
          settled_at?: string;
          note?: string | null;
        }
      >;
      chores: Table<
        Chore,
        Omit<
          Chore,
          | "id" | "created_at" | "updated_at" | "done" | "done_at"
          | "done_by" | "position" | "notes" | "due_date" | "assigned_to"
        > & {
          notes?: string | null;
          due_date?: string | null;
          assigned_to?: string | null;
          done?: boolean;
          position?: number;
        }
      >;
      shopping_items: Table<
        ShoppingItem,
        // price_cents and expense_id are absent on purpose: the column grants
        // in 20260901000200 reserve them for charge_shopping_items(), so a
        // client that tries to set them is refused by Postgres. Leaving them
        // out here turns that into a compile error instead.
        Pick<ShoppingItem, "room_id" | "name" | "requested_by" | "for_users"> & {
          quantity?: string | null;
          notes?: string | null;
          assigned_to?: string | null;
          bought?: boolean;
          position?: number;
        },
        ShoppingItemPatch
      >;
    };
    Views: Record<string, never>;
    Functions: {
      create_room: {
        Args: {
          p_name: string;
          p_kind?: RoomKind;
          p_invite_mode?: InviteMode;
          p_invite_emails?: string[];
        };
        Returns: Room;
      };
      peek_room_by_code: {
        Args: { p_code: string };
        Returns: Array<{
          name: string;
          kind: RoomKind;
          invite_mode: InviteMode;
          member_count: number;
        }>;
      };
      join_room_with_code: {
        Args: { p_code: string };
        Returns: string;
      };
      create_expense: {
        Args: {
          p_room_id: string;
          p_description: string;
          p_amount_cents: number;
          p_paid_by: string;
          p_spent_at: string;
          p_split_type: SplitType;
          p_notes: string | null;
          p_splits: SplitInput[];
        };
        Returns: string;
      };
      update_expense: {
        Args: {
          p_expense_id: string;
          p_description: string;
          p_amount_cents: number;
          p_paid_by: string;
          p_spent_at: string;
          p_split_type: SplitType;
          p_notes: string | null;
          p_splits: SplitInput[];
        };
        Returns: string;
      };
      my_rooms: {
        Args: Record<string, never>;
        Returns: RoomSummaryRow[];
      };
      room_balances: {
        Args: { p_room_id: string };
        Returns: RoomBalanceRow[];
      };
      charge_shopping_items: {
        Args: {
          p_room_id: string;
          p_description: string;
          p_spent_at: string;
          p_lines: ChargeLine[];
        };
        Returns: string;
      };
    };
    Enums: {
      room_kind: RoomKind;
      invite_mode: InviteMode;
      split_type: SplitType;
      member_role: MemberRole;
    };
    CompositeTypes: Record<string, never>;
  };
};
