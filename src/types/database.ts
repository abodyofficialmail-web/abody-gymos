export type UserRole = "admin" | "trainer" | "member";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; role: UserRole; full_name: string | null; created_at: string; updated_at: string };
        Insert: { id: string; role?: UserRole; full_name?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; role?: UserRole; full_name?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      stores: {
        Row: {
          id: string;
          name: string;
          timezone: string | null;
          booking_cutoff_prev_day_time?: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          timezone?: string | null;
          booking_cutoff_prev_day_time?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          timezone?: string | null;
          booking_cutoff_prev_day_time?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      members: {
        Row: {
          id: string;
          user_id?: string | null;
          store_id?: string | null;
          display_name?: string | null;
          member_code: string;
          name: string | null;
          email?: string | null;
          phone?: string | null;
          needs_review?: boolean;
          line_user_id: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          store_id?: string | null;
          display_name?: string | null;
          member_code: string;
          name?: string | null;
          email?: string | null;
          phone?: string | null;
          needs_review?: boolean;
          line_user_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          store_id?: string | null;
          display_name?: string | null;
          member_code?: string;
          name?: string | null;
          email?: string | null;
          phone?: string | null;
          needs_review?: boolean;
          line_user_id?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      line_channel_default_stores: {
        Row: {
          line_destination_id: string;
          default_store_id: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          line_destination_id: string;
          default_store_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          line_destination_id?: string;
          default_store_id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      line_sessions: {
        Row: {
          user_id: string;
          status: "idle" | "confirm";
          temp_member_id: string | null;
          temp_member_code: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          status: "idle" | "confirm";
          temp_member_id?: string | null;
          temp_member_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          user_id?: string;
          status?: "idle" | "confirm";
          temp_member_id?: string | null;
          temp_member_code?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      client_notes: {
        Row: {
          id: string;
          member_id: string;
          store_id: string;
          trainer_id: string;
          date: string;
          content: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          member_id: string;
          store_id: string;
          trainer_id: string;
          date: string;
          content: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          member_id?: string;
          store_id?: string;
          trainer_id?: string;
          date?: string;
          content?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      trainer_shifts: {
        Row: {
          id: string;
          trainer_id: string;
          store_id: string;
          shift_date: string;
          start_local: string;
          end_local: string;
          break_minutes: number;
          status: string;
          is_break: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          trainer_id: string;
          store_id: string;
          shift_date: string;
          start_local: string;
          end_local: string;
          break_minutes?: number;
          status: string;
          is_break?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          trainer_id?: string;
          store_id?: string;
          shift_date?: string;
          start_local?: string;
          end_local?: string;
          break_minutes?: number;
          status?: string;
          is_break?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      trainer_transport_costs: {
        Row: { id: string; trainer_id: string | null; store_id: string | null; cost: number; };
        Insert: { id?: string; trainer_id?: string | null; store_id?: string | null; cost?: number; };
        Update: { id?: string; trainer_id?: string | null; store_id?: string | null; cost?: number; };
        Relationships: [];
      };
      trainer_expenses: {
        Row: { id: string; trainer_id: string | null; title: string; amount: number; type: "monthly" | "daily"; };
        Insert: { id?: string; trainer_id?: string | null; title?: string; amount?: number; type?: "monthly" | "daily"; };
        Update: { id?: string; trainer_id?: string | null; title?: string; amount?: number; type?: "monthly" | "daily"; };
        Relationships: [];
      };
      trainer_shift_breaks: {
        Row: { id: string; shift_id: string; start_time: string; end_time: string; created_at: string };
        Insert: { id?: string; shift_id: string; start_time: string; end_time: string; created_at?: string };
        Update: { id?: string; shift_id?: string; start_time?: string; end_time?: string; created_at?: string };
        Relationships: [];
      };
      trainer_events: {
        Row: {
          id: string;
          store_id: string;
          trainer_id: string;
          event_date: string;
          start_local: string;
          end_local: string;
          title: string;
          notes: string | null;
          block_booking: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          trainer_id: string;
          event_date: string;
          start_local: string;
          end_local: string;
          title?: string;
          notes?: string | null;
          block_booking?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          trainer_id?: string;
          event_date?: string;
          start_local?: string;
          end_local?: string;
          title?: string;
          notes?: string | null;
          block_booking?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      trainer_event_reminder_dispatches: {
        Row: { event_id: string; kind: "60min" | "10min"; sent_at: string };
        Insert: { event_id: string; kind: "60min" | "10min"; sent_at?: string };
        Update: { event_id?: string; kind?: "60min" | "10min"; sent_at?: string };
        Relationships: [];
      };
      reservations: {
        Row: {
          id: string;
          store_id: string;
          member_id: string | null;
          trainer_id: string | null;
          start_at: string;
          end_at: string;
          session_type: string | null;
          reschedule_count?: number;
          last_rescheduled_at?: string | null;
          status: string;
          notes: string | null;
          guest_name?: string | null;
          blocks_capacity?: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          member_id?: string | null;
          trainer_id?: string | null;
          start_at: string;
          end_at: string;
          session_type?: string | null;
          reschedule_count?: number;
          last_rescheduled_at?: string | null;
          status: string;
          notes?: string | null;
          guest_name?: string | null;
          blocks_capacity?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          member_id?: string | null;
          trainer_id?: string | null;
          start_at?: string;
          end_at?: string;
          session_type?: string | null;
          reschedule_count?: number;
          last_rescheduled_at?: string | null;
          status?: string;
          notes?: string | null;
          guest_name?: string | null;
          blocks_capacity?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      trainers: {
        Row: {
          id: string;
          user_id: string | null;
          store_id: string;
          display_name: string;
          email: string | null;
          hourly_rate_yen: number | null;
          hourly_rate: number;
          monthly_pass_cost: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string | null;
          store_id: string;
          display_name: string;
          email?: string | null;
          hourly_rate_yen?: number | null;
          hourly_rate?: number;
          monthly_pass_cost?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string | null;
          store_id?: string;
          display_name?: string;
          email?: string | null;
          hourly_rate_yen?: number | null;
          hourly_rate?: number;
          monthly_pass_cost?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {};
    Functions: {};
    Enums: {};
    CompositeTypes: {};
  };
}

