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
        Row: { id: string; name: string; is_active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; name: string; is_active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; name?: string; is_active?: boolean; created_at?: string; updated_at?: string };
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

