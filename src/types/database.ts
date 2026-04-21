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
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          timezone?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          timezone?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      members: {
        Row: {
          id: string;
          member_code: string;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          member_code: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          member_code?: string;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
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
          status: string;
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
          status: string;
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
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      reservations: {
        Row: {
          id: string;
          store_id: string;
          member_id: string;
          trainer_id: string | null;
          start_at: string;
          end_at: string;
          status: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          store_id: string;
          member_id: string;
          trainer_id?: string | null;
          start_at: string;
          end_at: string;
          status: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          store_id?: string;
          member_id?: string;
          trainer_id?: string | null;
          start_at?: string;
          end_at?: string;
          status?: string;
          notes?: string | null;
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

