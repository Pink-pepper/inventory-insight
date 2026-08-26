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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          created_at: string
          detail: Json
          event: string
          id: string
          org_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          detail?: Json
          event: string
          id?: string
          org_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          detail?: Json
          event?: string
          id?: string
          org_id?: string
          user_id?: string
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
      channels: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          org_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          org_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "channels_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          created_at: string
          customer_id: string | null
          email: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
          phone: string | null
          role: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          phone?: string | null
          role?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          phone?: string | null
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_components: {
        Row: {
          amount: number
          basis: Database["public"]["Enums"]["cost_basis"]
          created_at: string
          currency_code: string | null
          effective_from: string | null
          id: string
          kind: Database["public"]["Enums"]["cost_component_kind"]
          label: string | null
          notes: string | null
          org_id: string
          product_id: string | null
          shipment_id: string | null
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          basis?: Database["public"]["Enums"]["cost_basis"]
          created_at?: string
          currency_code?: string | null
          effective_from?: string | null
          id?: string
          kind: Database["public"]["Enums"]["cost_component_kind"]
          label?: string | null
          notes?: string | null
          org_id: string
          product_id?: string | null
          shipment_id?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          basis?: Database["public"]["Enums"]["cost_basis"]
          created_at?: string
          currency_code?: string | null
          effective_from?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["cost_component_kind"]
          label?: string | null
          notes?: string | null
          org_id?: string
          product_id?: string | null
          shipment_id?: string | null
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cost_components_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_components_org_id_product_id_fkey"
            columns: ["org_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "cost_components_org_id_shipment_id_fkey"
            columns: ["org_id", "shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "cost_components_org_id_supplier_id_fkey"
            columns: ["org_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "cost_components_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_components_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cost_components_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      customer_orders: {
        Row: {
          channel: Database["public"]["Enums"]["channel_kind"]
          confirmation: string | null
          created_at: string
          currency_code: string | null
          customer_id: string | null
          id: string
          notes: string | null
          org_id: string
          period_end: string | null
          period_start: string
          product_id: string | null
          quantity: number
          quotation_id: string | null
          reference: string | null
          status: Database["public"]["Enums"]["commercial_status"]
          unit: string | null
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["channel_kind"]
          confirmation?: string | null
          created_at?: string
          currency_code?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          org_id: string
          period_end?: string | null
          period_start: string
          product_id?: string | null
          quantity?: number
          quotation_id?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["commercial_status"]
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["channel_kind"]
          confirmation?: string | null
          created_at?: string
          currency_code?: string | null
          customer_id?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          period_end?: string | null
          period_start?: string
          product_id?: string | null
          quantity?: number
          quotation_id?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["commercial_status"]
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "customer_orders_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_orders_quotation_id_fkey"
            columns: ["quotation_id"]
            isOneToOne: false
            referencedRelation: "quotations"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          created_at: string
          external_ref: string
          id: string
          name: string
          org_id: string
          segment: string | null
        }
        Insert: {
          created_at?: string
          external_ref: string
          id?: string
          name: string
          org_id: string
          segment?: string | null
        }
        Update: {
          created_at?: string
          external_ref?: string
          id?: string
          name?: string
          org_id?: string
          segment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customers_org_id_fkey"
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
      demand_forecasts: {
        Row: {
          baseline_qty: number
          created_at: string
          high_qty: number | null
          id: string
          import_batch_id: string | null
          location_id: string | null
          low_qty: number | null
          method: string | null
          org_id: string
          period_month: string
          product_id: string
          source_ref: string | null
          source_row_hash: string
        }
        Insert: {
          baseline_qty: number
          created_at?: string
          high_qty?: number | null
          id?: string
          import_batch_id?: string | null
          location_id?: string | null
          low_qty?: number | null
          method?: string | null
          org_id: string
          period_month: string
          product_id: string
          source_ref?: string | null
          source_row_hash: string
        }
        Update: {
          baseline_qty?: number
          created_at?: string
          high_qty?: number | null
          id?: string
          import_batch_id?: string | null
          location_id?: string | null
          low_qty?: number | null
          method?: string | null
          org_id?: string
          period_month?: string
          product_id?: string
          source_ref?: string | null
          source_row_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "demand_forecasts_org_batch_fkey"
            columns: ["org_id", "import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demand_forecasts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_forecasts_org_location_fkey"
            columns: ["org_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "demand_forecasts_org_product_fkey"
            columns: ["org_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      demand_signals: {
        Row: {
          certainty: Database["public"]["Enums"]["demand_certainty"]
          channel: Database["public"]["Enums"]["channel_kind"]
          created_at: string
          currency_code: string | null
          customer_id: string | null
          expected_period: string
          id: string
          notes: string | null
          org_id: string
          probability: number | null
          product_id: string
          quantity: number
          source: Database["public"]["Enums"]["demand_source"]
          source_record_id: string | null
          source_record_type: string | null
          status: Database["public"]["Enums"]["commercial_status"]
          supersedes_id: string | null
          unit: string | null
          unit_price: number | null
          updated_at: string
        }
        Insert: {
          certainty: Database["public"]["Enums"]["demand_certainty"]
          channel?: Database["public"]["Enums"]["channel_kind"]
          created_at?: string
          currency_code?: string | null
          customer_id?: string | null
          expected_period: string
          id?: string
          notes?: string | null
          org_id: string
          probability?: number | null
          product_id: string
          quantity?: number
          source: Database["public"]["Enums"]["demand_source"]
          source_record_id?: string | null
          source_record_type?: string | null
          status?: Database["public"]["Enums"]["commercial_status"]
          supersedes_id?: string | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Update: {
          certainty?: Database["public"]["Enums"]["demand_certainty"]
          channel?: Database["public"]["Enums"]["channel_kind"]
          created_at?: string
          currency_code?: string | null
          customer_id?: string | null
          expected_period?: string
          id?: string
          notes?: string | null
          org_id?: string
          probability?: number | null
          product_id?: string
          quantity?: number
          source?: Database["public"]["Enums"]["demand_source"]
          source_record_id?: string | null
          source_record_type?: string | null
          status?: Database["public"]["Enums"]["commercial_status"]
          supersedes_id?: string | null
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "demand_signals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_signals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_signals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "demand_signals_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "demand_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          created_at: string
          created_by: string
          filename: string
          id: string
          org_id: string
          rows_accepted: number
          rows_read: number
          rows_rejected: number
          sheet_summary: Json
          source: string
          status: string
          warnings: number
        }
        Insert: {
          created_at?: string
          created_by: string
          filename: string
          id?: string
          org_id: string
          rows_accepted?: number
          rows_read?: number
          rows_rejected?: number
          sheet_summary?: Json
          source?: string
          status?: string
          warnings?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          filename?: string
          id?: string
          org_id?: string
          rows_accepted?: number
          rows_read?: number
          rows_rejected?: number
          sheet_summary?: Json
          source?: string
          status?: string
          warnings?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_org_id_fkey"
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
          import_batch_id: string | null
          location: string
          location_id: string | null
          on_hand: number
          on_order: number
          org_id: string
          product_id: string
          source_ref: string | null
        }
        Insert: {
          as_of?: string
          id?: string
          import_batch_id?: string | null
          location?: string
          location_id?: string | null
          on_hand?: number
          on_order?: number
          org_id: string
          product_id: string
          source_ref?: string | null
        }
        Update: {
          as_of?: string
          id?: string
          import_batch_id?: string | null
          location?: string
          location_id?: string | null
          on_hand?: number
          on_order?: number
          org_id?: string
          product_id?: string
          source_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_org_batch_fkey"
            columns: ["org_id", "import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "inventory_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_org_location_fkey"
            columns: ["org_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "inventory_org_product_fkey"
            columns: ["org_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          cogs: number | null
          created_at: string
          currency_code: string | null
          id: string
          import_batch_id: string | null
          location_id: string | null
          movement_class: Database["public"]["Enums"]["movement_class"]
          occurred_on: string
          org_id: string
          original_amount: number | null
          product_id: string
          quantity: number
          source_reason: string | null
          source_ref: string | null
          source_row_hash: string
          value: number | null
        }
        Insert: {
          cogs?: number | null
          created_at?: string
          currency_code?: string | null
          id?: string
          import_batch_id?: string | null
          location_id?: string | null
          movement_class?: Database["public"]["Enums"]["movement_class"]
          occurred_on: string
          org_id: string
          original_amount?: number | null
          product_id: string
          quantity: number
          source_reason?: string | null
          source_ref?: string | null
          source_row_hash: string
          value?: number | null
        }
        Update: {
          cogs?: number | null
          created_at?: string
          currency_code?: string | null
          id?: string
          import_batch_id?: string | null
          location_id?: string | null
          movement_class?: Database["public"]["Enums"]["movement_class"]
          occurred_on?: string
          org_id?: string
          original_amount?: number | null
          product_id?: string
          quantity?: number
          source_reason?: string | null
          source_ref?: string | null
          source_row_hash?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "movements_org_batch_fkey"
            columns: ["org_id", "import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "movements_org_location_fkey"
            columns: ["org_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "movements_org_product_fkey"
            columns: ["org_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      locations: {
        Row: {
          code: string
          country: string | null
          created_at: string
          id: string
          name: string
          org_id: string
          region: string | null
          state_province: string | null
        }
        Insert: {
          code: string
          country?: string | null
          created_at?: string
          id?: string
          name: string
          org_id: string
          region?: string | null
          state_province?: string | null
        }
        Update: {
          code?: string
          country?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
          region?: string | null
          state_province?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "locations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      market_signals: {
        Row: {
          created_at: string
          customer_id: string | null
          detail: string | null
          id: string
          impact: string
          kind: string
          observed_on: string
          org_id: string
          product_id: string | null
          supplier_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          detail?: string | null
          id?: string
          impact?: string
          kind: string
          observed_on?: string
          org_id: string
          product_id?: string | null
          supplier_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          detail?: string | null
          id?: string
          impact?: string
          kind?: string
          observed_on?: string
          org_id?: string
          product_id?: string | null
          supplier_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "market_signals_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_signals_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_signals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "market_signals_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
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
      opportunities: {
        Row: {
          channel: Database["public"]["Enums"]["channel_kind"]
          created_at: string
          currency_code: string | null
          customer_id: string | null
          expected_period: string
          expected_unit_price: number | null
          id: string
          notes: string | null
          org_id: string
          probability: number
          product_id: string | null
          quantity: number
          requirement_id: string | null
          status: Database["public"]["Enums"]["commercial_status"]
          title: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["channel_kind"]
          created_at?: string
          currency_code?: string | null
          customer_id?: string | null
          expected_period: string
          expected_unit_price?: number | null
          id?: string
          notes?: string | null
          org_id: string
          probability?: number
          product_id?: string | null
          quantity?: number
          requirement_id?: string | null
          status?: Database["public"]["Enums"]["commercial_status"]
          title: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["channel_kind"]
          created_at?: string
          currency_code?: string | null
          customer_id?: string | null
          expected_period?: string
          expected_unit_price?: number | null
          id?: string
          notes?: string | null
          org_id?: string
          probability?: number
          product_id?: string | null
          quantity?: number
          requirement_id?: string | null
          status?: Database["public"]["Enums"]["commercial_status"]
          title?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "opportunities_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opportunities_requirement_id_fkey"
            columns: ["requirement_id"]
            isOneToOne: false
            referencedRelation: "requirements"
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
      planning_policies: {
        Row: {
          created_at: string
          days_of_cover_target: number | null
          default_lead_time_days: number | null
          default_min_order_qty: number | null
          demand_growth_pct: number | null
          demand_method: string | null
          demand_variability: number | null
          demand_window_months: number | null
          id: string
          lead_time_variability_days: number | null
          minimum_stock_level: number | null
          order_multiple: number | null
          org_id: string
          planning_horizon_days: number | null
          product_display: string
          reorder_point_override: number | null
          safety_stock_days: number | null
          seasonality_enabled: boolean | null
          service_level: number | null
          target_stock_level: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          days_of_cover_target?: number | null
          default_lead_time_days?: number | null
          default_min_order_qty?: number | null
          demand_growth_pct?: number | null
          demand_method?: string | null
          demand_variability?: number | null
          demand_window_months?: number | null
          id?: string
          lead_time_variability_days?: number | null
          minimum_stock_level?: number | null
          order_multiple?: number | null
          org_id: string
          planning_horizon_days?: number | null
          product_display?: string
          reorder_point_override?: number | null
          safety_stock_days?: number | null
          seasonality_enabled?: boolean | null
          service_level?: number | null
          target_stock_level?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          days_of_cover_target?: number | null
          default_lead_time_days?: number | null
          default_min_order_qty?: number | null
          demand_growth_pct?: number | null
          demand_method?: string | null
          demand_variability?: number | null
          demand_window_months?: number | null
          id?: string
          lead_time_variability_days?: number | null
          minimum_stock_level?: number | null
          order_multiple?: number | null
          org_id?: string
          planning_horizon_days?: number | null
          product_display?: string
          reorder_point_override?: number | null
          safety_stock_days?: number | null
          seasonality_enabled?: boolean | null
          service_level?: number | null
          target_stock_level?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "planning_policies_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
          unit_price: number | null
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
          unit_price?: number | null
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
          unit_price?: number | null
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
            foreignKeyName: "products_org_supplier_fkey"
            columns: ["org_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["org_id", "id"]
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
          approval_status: Database["public"]["Enums"]["po_approval_status"]
          buyer: string | null
          created_at: string
          currency_code: string | null
          expected_at: string | null
          id: string
          import_batch_id: string | null
          location_id: string | null
          ordered_at: string | null
          org_id: string
          po_number: string | null
          product_id: string | null
          quantity: number
          received_at: string | null
          received_quantity: number
          source_row_hash: string | null
          status: Database["public"]["Enums"]["po_status"]
          supplier_id: string | null
          unit_cost: number
        }
        Insert: {
          approval_status?: Database["public"]["Enums"]["po_approval_status"]
          buyer?: string | null
          created_at?: string
          currency_code?: string | null
          expected_at?: string | null
          id?: string
          import_batch_id?: string | null
          location_id?: string | null
          ordered_at?: string | null
          org_id: string
          po_number?: string | null
          product_id?: string | null
          quantity?: number
          received_at?: string | null
          received_quantity?: number
          source_row_hash?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          unit_cost?: number
        }
        Update: {
          approval_status?: Database["public"]["Enums"]["po_approval_status"]
          buyer?: string | null
          created_at?: string
          currency_code?: string | null
          expected_at?: string | null
          id?: string
          import_batch_id?: string | null
          location_id?: string | null
          ordered_at?: string | null
          org_id?: string
          po_number?: string | null
          product_id?: string | null
          quantity?: number
          received_at?: string | null
          received_quantity?: number
          source_row_hash?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_org_batch_fk"
            columns: ["org_id", "import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "purchase_orders_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_orders_org_location_fkey"
            columns: ["org_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "purchase_orders_org_product_fkey"
            columns: ["org_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "purchase_orders_org_supplier_fkey"
            columns: ["org_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      quotations: {
        Row: {
          channel: Database["public"]["Enums"]["channel_kind"]
          created_at: string
          currency_code: string | null
          customer_id: string | null
          expected_period: string
          id: string
          issued_on: string | null
          notes: string | null
          opportunity_id: string | null
          org_id: string
          product_id: string | null
          quantity: number
          reference: string | null
          status: Database["public"]["Enums"]["commercial_status"]
          unit: string | null
          unit_price: number | null
          updated_at: string
          valid_until: string | null
        }
        Insert: {
          channel?: Database["public"]["Enums"]["channel_kind"]
          created_at?: string
          currency_code?: string | null
          customer_id?: string | null
          expected_period: string
          id?: string
          issued_on?: string | null
          notes?: string | null
          opportunity_id?: string | null
          org_id: string
          product_id?: string | null
          quantity?: number
          reference?: string | null
          status?: Database["public"]["Enums"]["commercial_status"]
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
          valid_until?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["channel_kind"]
          created_at?: string
          currency_code?: string | null
          customer_id?: string | null
          expected_period?: string
          id?: string
          issued_on?: string | null
          notes?: string | null
          opportunity_id?: string | null
          org_id?: string
          product_id?: string | null
          quantity?: number
          reference?: string | null
          status?: Database["public"]["Enums"]["commercial_status"]
          unit?: string | null
          unit_price?: number | null
          updated_at?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotations_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "opportunities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotations_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
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
            foreignKeyName: "recommendations_org_product_fkey"
            columns: ["org_id", "product_id"]
            isOneToOne: true
            referencedRelation: "products"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      requirements: {
        Row: {
          channel: Database["public"]["Enums"]["channel_kind"]
          created_at: string
          customer_id: string | null
          id: string
          notes: string | null
          org_id: string
          period_end: string | null
          period_start: string
          product_id: string | null
          quantity: number
          status: Database["public"]["Enums"]["commercial_status"]
          unit: string | null
          updated_at: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["channel_kind"]
          created_at?: string
          customer_id?: string | null
          id?: string
          notes?: string | null
          org_id: string
          period_end?: string | null
          period_start: string
          product_id?: string | null
          quantity?: number
          status?: Database["public"]["Enums"]["commercial_status"]
          unit?: string | null
          updated_at?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["channel_kind"]
          created_at?: string
          customer_id?: string | null
          id?: string
          notes?: string | null
          org_id?: string
          period_end?: string | null
          period_start?: string
          product_id?: string | null
          quantity?: number
          status?: Database["public"]["Enums"]["commercial_status"]
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "requirements_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirements_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "requirements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          cogs: number | null
          id: string
          import_batch_id: string | null
          org_id: string
          period_month: string
          product_id: string
          quantity: number
          revenue: number
          source_ref: string | null
        }
        Insert: {
          cogs?: number | null
          id?: string
          import_batch_id?: string | null
          org_id: string
          period_month: string
          product_id: string
          quantity?: number
          revenue?: number
          source_ref?: string | null
        }
        Update: {
          cogs?: number | null
          id?: string
          import_batch_id?: string | null
          org_id?: string
          period_month?: string
          product_id?: string
          quantity?: number
          revenue?: number
          source_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_org_batch_fkey"
            columns: ["org_id", "import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sales_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_org_product_fkey"
            columns: ["org_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      sales_transactions: {
        Row: {
          channel_id: string | null
          cogs: number | null
          created_at: string
          currency_code: string | null
          customer_id: string | null
          id: string
          import_batch_id: string | null
          location_id: string | null
          occurred_on: string
          org_id: string
          original_amount: number | null
          product_id: string
          quantity: number
          region: string | null
          source_ref: string | null
          source_row_hash: string
          state_province: string | null
          unit_price: number | null
          value: number | null
        }
        Insert: {
          channel_id?: string | null
          cogs?: number | null
          created_at?: string
          currency_code?: string | null
          customer_id?: string | null
          id?: string
          import_batch_id?: string | null
          location_id?: string | null
          occurred_on: string
          org_id: string
          original_amount?: number | null
          product_id: string
          quantity?: number
          region?: string | null
          source_ref?: string | null
          source_row_hash: string
          state_province?: string | null
          unit_price?: number | null
          value?: number | null
        }
        Update: {
          channel_id?: string | null
          cogs?: number | null
          created_at?: string
          currency_code?: string | null
          customer_id?: string | null
          id?: string
          import_batch_id?: string | null
          location_id?: string | null
          occurred_on?: string
          org_id?: string
          original_amount?: number | null
          product_id?: string
          quantity?: number
          region?: string | null
          source_ref?: string | null
          source_row_hash?: string
          state_province?: string | null
          unit_price?: number | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sales_transactions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_tx_org_batch_fkey"
            columns: ["org_id", "import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sales_tx_org_channel_fkey"
            columns: ["org_id", "channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sales_tx_org_customer_fkey"
            columns: ["org_id", "customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sales_tx_org_location_fkey"
            columns: ["org_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "sales_tx_org_product_fkey"
            columns: ["org_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      scenario_runs: {
        Row: {
          assumptions: Json
          baseline_summary: Json
          created_at: string
          created_by: string
          id: string
          input_provenance: Json
          org_id: string
          row_results: Json
          scenario_id: string
          scenario_summary: Json
          scope: Json
          version: number
        }
        Insert: {
          assumptions: Json
          baseline_summary: Json
          created_at?: string
          created_by: string
          id?: string
          input_provenance: Json
          org_id: string
          row_results: Json
          scenario_id: string
          scenario_summary: Json
          scope?: Json
          version: number
        }
        Update: {
          assumptions?: Json
          baseline_summary?: Json
          created_at?: string
          created_by?: string
          id?: string
          input_provenance?: Json
          org_id?: string
          row_results?: Json
          scenario_id?: string
          scenario_summary?: Json
          scope?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "scenario_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scenario_runs_org_id_scenario_id_fkey"
            columns: ["org_id", "scenario_id"]
            isOneToOne: false
            referencedRelation: "scenarios"
            referencedColumns: ["org_id", "id"]
          },
        ]
      }
      scenarios: {
        Row: {
          assumptions: Json
          created_at: string
          created_by: string
          description: string | null
          id: string
          name: string
          org_id: string
          scope: Json
          status: string
          updated_at: string
        }
        Insert: {
          assumptions?: Json
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          name: string
          org_id: string
          scope?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          assumptions?: Json
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          scope?: Json
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "scenarios_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      shipment_lines: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          org_id: string
          product_id: string | null
          purchase_order_id: string | null
          quantity: number
          shipment_id: string
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          org_id: string
          product_id?: string | null
          purchase_order_id?: string | null
          quantity?: number
          shipment_id: string
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          org_id?: string
          product_id?: string | null
          purchase_order_id?: string | null
          quantity?: number
          shipment_id?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipment_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_lines_org_id_product_id_fkey"
            columns: ["org_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "shipment_lines_org_id_shipment_id_fkey"
            columns: ["org_id", "shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "shipment_lines_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_lines_purchase_order_id_fkey"
            columns: ["purchase_order_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipment_lines_shipment_id_fkey"
            columns: ["shipment_id"]
            isOneToOne: false
            referencedRelation: "shipments"
            referencedColumns: ["id"]
          },
        ]
      }
      shipments: {
        Row: {
          arrived_on: string | null
          cleared_on: string | null
          created_at: string
          currency_code: string | null
          delivered_on: string | null
          eta: string | null
          etd: string | null
          fx_rate: number | null
          id: string
          incoterm: string | null
          location_id: string | null
          mode: string | null
          notes: string | null
          org_id: string
          reference: string
          revised_eta: string | null
          status: Database["public"]["Enums"]["shipment_status"]
          supplier_id: string | null
          updated_at: string
        }
        Insert: {
          arrived_on?: string | null
          cleared_on?: string | null
          created_at?: string
          currency_code?: string | null
          delivered_on?: string | null
          eta?: string | null
          etd?: string | null
          fx_rate?: number | null
          id?: string
          incoterm?: string | null
          location_id?: string | null
          mode?: string | null
          notes?: string | null
          org_id: string
          reference: string
          revised_eta?: string | null
          status?: Database["public"]["Enums"]["shipment_status"]
          supplier_id?: string | null
          updated_at?: string
        }
        Update: {
          arrived_on?: string | null
          cleared_on?: string | null
          created_at?: string
          currency_code?: string | null
          delivered_on?: string | null
          eta?: string | null
          etd?: string | null
          fx_rate?: number | null
          id?: string
          incoterm?: string | null
          location_id?: string | null
          mode?: string | null
          notes?: string | null
          org_id?: string
          reference?: string
          revised_eta?: string | null
          status?: Database["public"]["Enums"]["shipment_status"]
          supplier_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shipments_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shipments_org_id_location_id_fkey"
            columns: ["org_id", "location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "shipments_org_id_supplier_id_fkey"
            columns: ["org_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "shipments_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_products: {
        Row: {
          created_at: string
          currency_code: string | null
          id: string
          is_active: boolean
          lead_time_days: number | null
          min_order_qty: number | null
          notes: string | null
          org_id: string
          product_id: string
          supplier_id: string
          supplier_price: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency_code?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number | null
          min_order_qty?: number | null
          notes?: string | null
          org_id: string
          product_id: string
          supplier_id: string
          supplier_price?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency_code?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number | null
          min_order_qty?: number | null
          notes?: string | null
          org_id?: string
          product_id?: string
          supplier_id?: string
          supplier_price?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_products_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_org_id_product_id_fkey"
            columns: ["org_id", "product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "supplier_products_org_id_supplier_id_fkey"
            columns: ["org_id", "supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["org_id", "id"]
          },
          {
            foreignKeyName: "supplier_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_products_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
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
      channel_kind: "direct_shipment" | "dropship" | "stock"
      commercial_status:
        | "open"
        | "won"
        | "lost"
        | "cancelled"
        | "expired"
        | "superseded"
        | "fulfilled"
      connector_type:
        | "csv"
        | "odoo"
        | "sap"
        | "dynamics"
        | "netsuite"
        | "custom_api"
      cost_basis: "per_unit" | "per_shipment" | "percent_of_value"
      cost_component_kind: "freight" | "duty" | "clearance" | "other" | "fx"
      demand_certainty:
        | "speculative"
        | "expected"
        | "active"
        | "high_confidence"
        | "committed"
        | "confirmed"
        | "actual"
      demand_source:
        | "history"
        | "requirement"
        | "opportunity"
        | "quotation"
        | "lpo"
        | "order"
        | "market"
        | "planner"
      movement_class:
        | "sale"
        | "consumption"
        | "sampling"
        | "promotional"
        | "service_use"
        | "damage"
        | "expiry"
        | "quality_loss"
        | "return"
        | "adjustment"
        | "transfer"
        | "assembly"
        | "other"
      org_role: "owner" | "admin" | "member"
      po_approval_status: "needs_review" | "approved" | "rejected"
      po_status: "draft" | "placed" | "received" | "cancelled" | "closed"
      rec_action: "REORDER" | "WATCH" | "HOLD" | "EXCESS"
      shipment_status:
        | "planned"
        | "booked"
        | "in_transit"
        | "arrived"
        | "clearing"
        | "cleared"
        | "delivered"
        | "cancelled"
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
      channel_kind: ["direct_shipment", "dropship", "stock"],
      commercial_status: [
        "open",
        "won",
        "lost",
        "cancelled",
        "expired",
        "superseded",
        "fulfilled",
      ],
      connector_type: [
        "csv",
        "odoo",
        "sap",
        "dynamics",
        "netsuite",
        "custom_api",
      ],
      cost_basis: ["per_unit", "per_shipment", "percent_of_value"],
      cost_component_kind: ["freight", "duty", "clearance", "other", "fx"],
      demand_certainty: [
        "speculative",
        "expected",
        "active",
        "high_confidence",
        "committed",
        "confirmed",
        "actual",
      ],
      demand_source: [
        "history",
        "requirement",
        "opportunity",
        "quotation",
        "lpo",
        "order",
        "market",
        "planner",
      ],
      movement_class: [
        "sale",
        "consumption",
        "sampling",
        "promotional",
        "service_use",
        "damage",
        "expiry",
        "quality_loss",
        "return",
        "adjustment",
        "transfer",
        "assembly",
        "other",
      ],
      org_role: ["owner", "admin", "member"],
      po_approval_status: ["needs_review", "approved", "rejected"],
      po_status: ["draft", "placed", "received", "cancelled", "closed"],
      rec_action: ["REORDER", "WATCH", "HOLD", "EXCESS"],
      shipment_status: [
        "planned",
        "booked",
        "in_transit",
        "arrived",
        "clearing",
        "cleared",
        "delivered",
        "cancelled",
      ],
    },
  },
} as const
