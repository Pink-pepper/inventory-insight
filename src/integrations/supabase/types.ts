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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          created_at: string
          detail: Json
          event: string
          id: string
          org_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          detail?: Json
          event: string
          id?: string
          org_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          detail?: Json
          event?: string
          id?: string
          org_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_sources: {
        Row: {
          connector: Database["public"]["Enums"]["connector_type"]
          created_at: string
          error_count: number
          id: string
          last_sync_at: string | null
          name: string
          org_id: string
          rows_ingested: number
          status: string
        }
        Insert: {
          connector?: Database["public"]["Enums"]["connector_type"]
          created_at?: string
          error_count?: number
          id?: string
          last_sync_at?: string | null
          name: string
          org_id: string
          rows_ingested?: number
          status?: string
        }
        Update: {
          connector?: Database["public"]["Enums"]["connector_type"]
          created_at?: string
          error_count?: number
          id?: string
          last_sync_at?: string | null
          name?: string
          org_id?: string
          rows_ingested?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_sources_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory: {
        Row: {
          as_of: string
          id: string
          location: string
          on_hand: number
          on_order: number
          org_id: string
          product_id: string
        }
        Insert: {
          as_of?: string
          id?: string
          location?: string
          on_hand?: number
          on_order?: number
          org_id: string
          product_id: string
        }
        Update: {
          as_of?: string
          id?: string
          location?: string
          on_hand?: number
          on_order?: number
          org_id?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      memberships: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["org_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          category: string
          created_at: string
          id: string
          is_active: boolean
          lead_time_days: number | null
          min_order_qty: number | null
          name: string
          org_id: string
          safety_stock_days: number
          sku: string
          supplier_id: string | null
          unit_cost: number
        }
        Insert: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          lead_time_days?: number | null
          min_order_qty?: number | null
          name: string
          org_id: string
          safety_stock_days?: number
          sku: string
          supplier_id?: string | null
          unit_cost?: number
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          lead_time_days?: number | null
          min_order_qty?: number | null
          name?: string
          org_id?: string
          safety_stock_days?: number
          sku?: string
          supplier_id?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          created_at: string
          expected_at: string | null
          id: string
          org_id: string
          product_id: string | null
          quantity: number
          status: Database["public"]["Enums"]["po_status"]
          supplier_id: string | null
          unit_cost: number
        }
        Insert: {
          created_at?: string
          expected_at?: string | null
          id?: string
          org_id: string
          product_id?: string | null
          quantity?: number
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          unit_cost?: number
        }
        Update: {
          created_at?: string
          expected_at?: string | null
          id?: string
          org_id?: string
          product_id?: string | null
          quantity?: number
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      recommendations: {
        Row: {
          action: Database["public"]["Enums"]["rec_action"]
          avg_daily_demand: number
          avg_monthly_demand: number
          days_of_cover: number
          estimated_cost: number
          generated_at: string
          id: string
          org_id: string
          product_id: string
          reason: string
          recommended_qty: number
          reorder_point: number
          run_id: string | null
          run_started_at: string | null
          safety_stock: number
        }
        Insert: {
          action: Database["public"]["Enums"]["rec_action"]
          avg_daily_demand?: number
          avg_monthly_demand?: number
          days_of_cover?: number
          estimated_cost?: number
          generated_at?: string
          id?: string
          org_id: string
          product_id: string
          reason?: string
          recommended_qty?: number
          reorder_point?: number
          run_id?: string | null
          run_started_at?: string | null
          safety_stock?: number
        }
        Update: {
          action?: Database["public"]["Enums"]["rec_action"]
          avg_daily_demand?: number
          avg_monthly_demand?: number
          days_of_cover?: number
          estimated_cost?: number
          generated_at?: string
          id?: string
          org_id?: string
          product_id?: string
          reason?: string
          recommended_qty?: number
          reorder_point?: number
          run_id?: string | null
          run_started_at?: string | null
          safety_stock?: number
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          id: string
          org_id: string
          period_month: string
          product_id: string
          quantity: number
          revenue: number
        }
        Insert: {
          id?: string
          org_id: string
          period_month: string
          product_id: string
          quantity?: number
          revenue?: number
        }
        Update: {
          id?: string
          org_id?: string
          period_month?: string
          product_id?: string
          quantity?: number
          revenue?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          code: string | null
          created_at: string
          external_ref: string | null
          id: string
          lead_time_days: number
          min_order_qty: number
          name: string
          org_id: string
          reliability: number
        }
        Insert: {
          code?: string | null
          created_at?: string
          external_ref?: string | null
          id?: string
          lead_time_days?: number
          min_order_qty?: number
          name: string
          org_id: string
          reliability?: number
        }
        Update: {
          code?: string | null
          created_at?: string
          external_ref?: string | null
          id?: string
          lead_time_days?: number
          min_order_qty?: number
          name?: string
          org_id?: string
          reliability?: number
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_org_role: {
        Args: {
          _org_id: string
          _roles: Database["public"]["Enums"]["org_role"][]
        }
        Returns: boolean
      }
      is_org_member: { Args: { _org_id: string }; Returns: boolean }
    }
    Enums: {
      connector_type:
        | "csv"
        | "odoo"
        | "sap"
        | "dynamics"
        | "netsuite"
        | "custom_api"
      org_role: "owner" | "admin" | "member"
      po_status: "draft" | "placed" | "received" | "cancelled"
      rec_action: "REORDER" | "WATCH" | "HOLD" | "EXCESS"
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
      connector_type: [
        "csv",
        "odoo",
        "sap",
        "dynamics",
        "netsuite",
        "custom_api",
      ],
      org_role: ["owner", "admin", "member"],
      po_status: ["draft", "placed", "received", "cancelled"],
      rec_action: ["REORDER", "WATCH", "HOLD", "EXCESS"],
    },
  },
} as const
