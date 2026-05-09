export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_account: {
        Row: {
          created_at: string
          id: string
          password_hash: string
          password_salt: string
          public_status_page: boolean
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          id?: string
          password_hash: string
          password_salt: string
          public_status_page?: boolean
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          id?: string
          password_hash?: string
          password_salt?: string
          public_status_page?: boolean
          updated_at?: string
          username?: string
        }
        Relationships: []
      }
      admin_sessions: {
        Row: {
          created_at: string
          expires_at: string
          token: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          token: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          token?: string
        }
        Relationships: []
      }
      heartbeats: {
        Row: {
          cert_days_remaining: number | null
          checked_at: string
          error_message: string | null
          id: string
          monitor_id: string
          response_time_ms: number | null
          status: Database["public"]["Enums"]["monitor_status"]
          status_code: number | null
          step_name: string | null
        }
        Insert: {
          cert_days_remaining?: number | null
          checked_at?: string
          error_message?: string | null
          id?: string
          monitor_id: string
          response_time_ms?: number | null
          status: Database["public"]["Enums"]["monitor_status"]
          status_code?: number | null
          step_name?: string | null
        }
        Update: {
          cert_days_remaining?: number | null
          checked_at?: string
          error_message?: string | null
          id?: string
          monitor_id?: string
          response_time_ms?: number | null
          status?: Database["public"]["Enums"]["monitor_status"]
          status_code?: number | null
          step_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "heartbeats_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: false
            referencedRelation: "monitors"
            referencedColumns: ["id"]
          },
        ]
      }
      incidents: {
        Row: {
          duration_seconds: number | null
          ended_at: string | null
          id: string
          monitor_id: string
          reason: string | null
          started_at: string
        }
        Insert: {
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          monitor_id: string
          reason?: string | null
          started_at?: string
        }
        Update: {
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          monitor_id?: string
          reason?: string | null
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_monitor_id_fkey"
            columns: ["monitor_id"]
            isOneToOne: false
            referencedRelation: "monitors"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_windows: {
        Row: {
          created_at: string
          ends_at: string
          id: string
          monitor_id: string | null
          recurrence: string
          starts_at: string
          title: string
          weekday: number | null
        }
        Insert: {
          created_at?: string
          ends_at: string
          id?: string
          monitor_id?: string | null
          recurrence?: string
          starts_at: string
          title: string
          weekday?: number | null
        }
        Update: {
          created_at?: string
          ends_at?: string
          id?: string
          monitor_id?: string | null
          recurrence?: string
          starts_at?: string
          title?: string
          weekday?: number | null
        }
        Relationships: []
      }
      monitors: {
        Row: {
          cert_expiry_warn_days: number
          created_at: string
          db_kind: string | null
          db_query: string | null
          db_secret_name: string | null
          degraded_threshold_ms: number | null
          dns_expected_values: string[] | null
          dns_record_type: string | null
          dns_resolver: string | null
          enabled: boolean
          expected_status_codes: string
          follow_redirects: boolean
          http_body: string | null
          http_body_type: string | null
          http_headers: Json
          http_method: string
          id: string
          ignore_tls_errors: boolean
          interval_minutes: number
          keyword: string | null
          keyword_match:
            | Database["public"]["Enums"]["keyword_match_type"]
            | null
          last_checked_at: string | null
          last_status: Database["public"]["Enums"]["monitor_status"]
          match_mode: string
          name: string
          push_grace_seconds: number
          push_token: string | null
          retry_count: number
          retry_interval_seconds: number
          steps: Json
          target: string
          timeout_seconds: number
          type: Database["public"]["Enums"]["monitor_type"]
          updated_at: string
        }
        Insert: {
          cert_expiry_warn_days?: number
          created_at?: string
          db_kind?: string | null
          db_query?: string | null
          db_secret_name?: string | null
          degraded_threshold_ms?: number | null
          dns_expected_values?: string[] | null
          dns_record_type?: string | null
          dns_resolver?: string | null
          enabled?: boolean
          expected_status_codes?: string
          follow_redirects?: boolean
          http_body?: string | null
          http_body_type?: string | null
          http_headers?: Json
          http_method?: string
          id?: string
          ignore_tls_errors?: boolean
          interval_minutes?: number
          keyword?: string | null
          keyword_match?:
            | Database["public"]["Enums"]["keyword_match_type"]
            | null
          last_checked_at?: string | null
          last_status?: Database["public"]["Enums"]["monitor_status"]
          match_mode?: string
          name: string
          push_grace_seconds?: number
          push_token?: string | null
          retry_count?: number
          retry_interval_seconds?: number
          steps?: Json
          target: string
          timeout_seconds?: number
          type: Database["public"]["Enums"]["monitor_type"]
          updated_at?: string
        }
        Update: {
          cert_expiry_warn_days?: number
          created_at?: string
          db_kind?: string | null
          db_query?: string | null
          db_secret_name?: string | null
          degraded_threshold_ms?: number | null
          dns_expected_values?: string[] | null
          dns_record_type?: string | null
          dns_resolver?: string | null
          enabled?: boolean
          expected_status_codes?: string
          follow_redirects?: boolean
          http_body?: string | null
          http_body_type?: string | null
          http_headers?: Json
          http_method?: string
          id?: string
          ignore_tls_errors?: boolean
          interval_minutes?: number
          keyword?: string | null
          keyword_match?:
            | Database["public"]["Enums"]["keyword_match_type"]
            | null
          last_checked_at?: string | null
          last_status?: Database["public"]["Enums"]["monitor_status"]
          match_mode?: string
          name?: string
          push_grace_seconds?: number
          push_token?: string | null
          retry_count?: number
          retry_interval_seconds?: number
          steps?: Json
          target?: string
          timeout_seconds?: number
          type?: Database["public"]["Enums"]["monitor_type"]
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      keyword_match_type: "contains" | "not_contains"
      monitor_status: "up" | "down" | "pending" | "degraded"
      monitor_type:
        | "http"
        | "tcp"
        | "ping"
        | "dns"
        | "multistep"
        | "database"
        | "push"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      keyword_match_type: ["contains", "not_contains"],
      monitor_status: ["up", "down", "pending", "degraded"],
      monitor_type: [
        "http",
        "tcp",
        "ping",
        "dns",
        "multistep",
        "database",
        "push",
      ],
    },
  },
} as const
