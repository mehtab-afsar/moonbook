export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      activities: {
        Row: {
          activity_type_id: string
          amount_minor: number
          bill_to_party_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          details: Json
          dim1_key: string | null
          dim1_value: string | null
          direct_cost_minor: number | null
          direction: string
          id: string
          notes: string | null
          occurred_on: string
          org_id: string
          party_id: string
          period_end: string | null
          period_start: string | null
          reference: string | null
          status: string
          updated_at: string
        }
        Insert: {
          activity_type_id: string
          amount_minor: number
          bill_to_party_id?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          details?: Json
          dim1_key?: string | null
          dim1_value?: string | null
          direct_cost_minor?: number | null
          direction: string
          id?: string
          notes?: string | null
          occurred_on: string
          org_id: string
          party_id: string
          period_end?: string | null
          period_start?: string | null
          reference?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          activity_type_id?: string
          amount_minor?: number
          bill_to_party_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          details?: Json
          dim1_key?: string | null
          dim1_value?: string | null
          direct_cost_minor?: number | null
          direction?: string
          id?: string
          notes?: string | null
          occurred_on?: string
          org_id?: string
          party_id?: string
          period_end?: string | null
          period_start?: string | null
          reference?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_activity_type_id_fkey"
            columns: ["activity_type_id"]
            isOneToOne: false
            referencedRelation: "activity_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_bill_to_party_id_fkey"
            columns: ["bill_to_party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_type_direction_fk"
            columns: ["activity_type_id", "direction"]
            isOneToOne: false
            referencedRelation: "activity_types"
            referencedColumns: ["id", "direction"]
          },
          {
            foreignKeyName: "activities_type_org_fk"
            columns: ["activity_type_id", "org_id"]
            isOneToOne: false
            referencedRelation: "activity_types"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      activity_fields: {
        Row: {
          activity_type_id: string
          archived_at: string | null
          created_at: string
          field_type: string
          id: string
          is_reportable: boolean
          is_required: boolean
          key: string
          label: string
          options: Json
          org_id: string | null
          show_on_document: boolean
          sort_order: number
        }
        Insert: {
          activity_type_id: string
          archived_at?: string | null
          created_at?: string
          field_type: string
          id?: string
          is_reportable?: boolean
          is_required?: boolean
          key: string
          label: string
          options?: Json
          org_id?: string | null
          show_on_document?: boolean
          sort_order?: number
        }
        Update: {
          activity_type_id?: string
          archived_at?: string | null
          created_at?: string
          field_type?: string
          id?: string
          is_reportable?: boolean
          is_required?: boolean
          key?: string
          label?: string
          options?: Json
          org_id?: string | null
          show_on_document?: boolean
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "activity_fields_activity_type_id_fkey"
            columns: ["activity_type_id"]
            isOneToOne: false
            referencedRelation: "activity_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_fields_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_fields_type_org_fk"
            columns: ["activity_type_id", "org_id"]
            isOneToOne: false
            referencedRelation: "activity_types"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      activity_types: {
        Row: {
          archived_at: string | null
          created_at: string
          dim1_field_key: string | null
          direction: string
          id: string
          key: string
          label_plural: string
          label_singular: string
          org_id: string | null
          pricing_config: Json
          pricing_strategy: string
          sort_order: number
          template_key: string | null
          updated_at: string
          uses_job_margin: boolean
          uses_period: boolean
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          dim1_field_key?: string | null
          direction: string
          id?: string
          key: string
          label_plural: string
          label_singular: string
          org_id?: string | null
          pricing_config?: Json
          pricing_strategy?: string
          sort_order?: number
          template_key?: string | null
          updated_at?: string
          uses_job_margin?: boolean
          uses_period?: boolean
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          dim1_field_key?: string | null
          direction?: string
          id?: string
          key?: string
          label_plural?: string
          label_singular?: string
          org_id?: string | null
          pricing_config?: Json
          pricing_strategy?: string
          sort_order?: number
          template_key?: string | null
          updated_at?: string
          uses_job_margin?: boolean
          uses_period?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "activity_types_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      allocations: {
        Row: {
          amount_minor: number
          created_at: string
          created_by: string | null
          credit_document_id: string | null
          id: string
          org_id: string
          payment_id: string | null
          target_document_id: string
        }
        Insert: {
          amount_minor: number
          created_at?: string
          created_by?: string | null
          credit_document_id?: string | null
          id?: string
          org_id: string
          payment_id?: string | null
          target_document_id: string
        }
        Update: {
          amount_minor?: number
          created_at?: string
          created_by?: string | null
          credit_document_id?: string | null
          id?: string
          org_id?: string
          payment_id?: string | null
          target_document_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "allocations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocations_credit_document_id_fkey"
            columns: ["credit_document_id"]
            isOneToOne: false
            referencedRelation: "credit_balances"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "allocations_credit_document_id_fkey"
            columns: ["credit_document_id"]
            isOneToOne: false
            referencedRelation: "document_balances"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "allocations_credit_document_id_fkey"
            columns: ["credit_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payment_balances"
            referencedColumns: ["payment_id"]
          },
          {
            foreignKeyName: "allocations_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "allocations_target_document_id_fkey"
            columns: ["target_document_id"]
            isOneToOne: false
            referencedRelation: "credit_balances"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "allocations_target_document_id_fkey"
            columns: ["target_document_id"]
            isOneToOne: false
            referencedRelation: "document_balances"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "allocations_target_document_id_fkey"
            columns: ["target_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          action: string
          actor_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          org_id: string
          reason: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          org_id: string
          reason?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          org_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_lines: {
        Row: {
          activity_id: string | null
          amount_minor: number
          created_at: string
          description: string
          discount_minor: number
          document_id: string
          hsn_sac: string | null
          id: string
          org_id: string
          quantity: number | null
          rate_minor: number | null
          sort_order: number
          unit: string | null
        }
        Insert: {
          activity_id?: string | null
          amount_minor: number
          created_at?: string
          description: string
          discount_minor?: number
          document_id: string
          hsn_sac?: string | null
          id?: string
          org_id: string
          quantity?: number | null
          rate_minor?: number | null
          sort_order?: number
          unit?: string | null
        }
        Update: {
          activity_id?: string | null
          amount_minor?: number
          created_at?: string
          description?: string
          discount_minor?: number
          document_id?: string
          hsn_sac?: string | null
          id?: string
          org_id?: string
          quantity?: number | null
          rate_minor?: number | null
          sort_order?: number
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "document_lines_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_lines_activity_id_fkey"
            columns: ["activity_id"]
            isOneToOne: false
            referencedRelation: "activity_margin"
            referencedColumns: ["activity_id"]
          },
          {
            foreignKeyName: "document_lines_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "credit_balances"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "document_lines_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_balances"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "document_lines_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_lines_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_sequences: {
        Row: {
          doc_kind: string
          last_value: number
          org_id: string
          period_key: string
          updated_at: string
        }
        Insert: {
          doc_kind: string
          last_value?: number
          org_id: string
          period_key: string
          updated_at?: string
        }
        Update: {
          doc_kind?: string
          last_value?: number
          org_id?: string
          period_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_sequences_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_series: {
        Row: {
          created_at: string
          doc_kind: string
          is_self_numbered: boolean
          org_id: string
          prefix: string
          reset_cadence: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          doc_kind: string
          is_self_numbered?: boolean
          org_id: string
          prefix: string
          reset_cadence?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          doc_kind?: string
          is_self_numbered?: boolean
          org_id?: string
          prefix?: string
          reset_cadence?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_series_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_taxes: {
        Row: {
          amount_minor: number
          component_code: string
          component_label: string
          created_at: string
          document_id: string
          id: string
          org_id: string
          rate_pct: number
          sort_order: number
        }
        Insert: {
          amount_minor: number
          component_code: string
          component_label: string
          created_at?: string
          document_id: string
          id?: string
          org_id: string
          rate_pct: number
          sort_order?: number
        }
        Update: {
          amount_minor?: number
          component_code?: string
          component_label?: string
          created_at?: string
          document_id?: string
          id?: string
          org_id?: string
          rate_pct?: number
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_taxes_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "credit_balances"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "document_taxes_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "document_balances"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "document_taxes_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_taxes_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          counterparty_id: string
          counterparty_override_reason: string | null
          created_at: string
          created_by: string | null
          currency: string
          direction: string
          disputed_reason: string | null
          doc_date: string
          doc_kind: string
          doc_no: string | null
          due_date: string | null
          id: string
          is_disputed: boolean
          issued_snapshot: Json | null
          notes: string | null
          offsets_document_id: string | null
          org_id: string
          party_doc_no: string | null
          pdf_path: string | null
          round_off_minor: number
          ship_to_party_id: string | null
          status: string
          tax_treatment: string
          taxable_value_minor: number
          total_minor: number
          updated_at: string
        }
        Insert: {
          counterparty_id: string
          counterparty_override_reason?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          direction: string
          disputed_reason?: string | null
          doc_date?: string
          doc_kind: string
          doc_no?: string | null
          due_date?: string | null
          id?: string
          is_disputed?: boolean
          issued_snapshot?: Json | null
          notes?: string | null
          offsets_document_id?: string | null
          org_id: string
          party_doc_no?: string | null
          pdf_path?: string | null
          round_off_minor?: number
          ship_to_party_id?: string | null
          status?: string
          tax_treatment?: string
          taxable_value_minor?: number
          total_minor?: number
          updated_at?: string
        }
        Update: {
          counterparty_id?: string
          counterparty_override_reason?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          direction?: string
          disputed_reason?: string | null
          doc_date?: string
          doc_kind?: string
          doc_no?: string | null
          due_date?: string | null
          id?: string
          is_disputed?: boolean
          issued_snapshot?: Json | null
          notes?: string | null
          offsets_document_id?: string | null
          org_id?: string
          party_doc_no?: string | null
          pdf_path?: string | null
          round_off_minor?: number
          ship_to_party_id?: string | null
          status?: string
          tax_treatment?: string
          taxable_value_minor?: number
          total_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_offsets_document_id_fkey"
            columns: ["offsets_document_id"]
            isOneToOne: false
            referencedRelation: "credit_balances"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "documents_offsets_document_id_fkey"
            columns: ["offsets_document_id"]
            isOneToOne: false
            referencedRelation: "document_balances"
            referencedColumns: ["document_id"]
          },
          {
            foreignKeyName: "documents_offsets_document_id_fkey"
            columns: ["offsets_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_ship_to_party_id_fkey"
            columns: ["ship_to_party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      industry_templates: {
        Row: {
          created_at: string
          description: string
          key: string
          label: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          description: string
          key: string
          label: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          description?: string
          key?: string
          label?: string
          sort_order?: number
        }
        Relationships: []
      }
      organisations: {
        Row: {
          address: string | null
          bank_details: Json
          base_currency: string
          country_code: string
          created_at: string
          default_tax_rate_pct: number
          fiscal_year_start_month: number
          id: string
          legal_name: string
          locale: string
          region_code: string | null
          tax_id: string | null
          tax_id_kind: string | null
          tax_regime: string
          timezone: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          bank_details?: Json
          base_currency: string
          country_code: string
          created_at?: string
          default_tax_rate_pct?: number
          fiscal_year_start_month?: number
          id?: string
          legal_name: string
          locale?: string
          region_code?: string | null
          tax_id?: string | null
          tax_id_kind?: string | null
          tax_regime?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          bank_details?: Json
          base_currency?: string
          country_code?: string
          created_at?: string
          default_tax_rate_pct?: number
          fiscal_year_start_month?: number
          id?: string
          legal_name?: string
          locale?: string
          region_code?: string | null
          tax_id?: string | null
          tax_id_kind?: string | null
          tax_regime?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      parties: {
        Row: {
          address: string | null
          country_code: string | null
          created_at: string
          created_by: string | null
          credit_limit_minor: number | null
          email: string | null
          id: string
          name: string
          notes: string | null
          org_id: string
          payment_terms_days: number
          phone: string | null
          region_code: string | null
          tax_id: string | null
          tax_id_kind: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit_minor?: number | null
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          org_id: string
          payment_terms_days?: number
          phone?: string | null
          region_code?: string | null
          tax_id?: string | null
          tax_id_kind?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          country_code?: string | null
          created_at?: string
          created_by?: string | null
          credit_limit_minor?: number | null
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          org_id?: string
          payment_terms_days?: number
          phone?: string | null
          region_code?: string | null
          tax_id?: string | null
          tax_id_kind?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "parties_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "parties_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_minor: number
          attachment_path: string | null
          created_at: string
          created_by: string | null
          currency: string
          direction: string
          id: string
          method: string
          notes: string | null
          org_id: string
          paid_on: string
          party_id: string
          reference_no: string | null
        }
        Insert: {
          amount_minor: number
          attachment_path?: string | null
          created_at?: string
          created_by?: string | null
          currency: string
          direction: string
          id?: string
          method: string
          notes?: string | null
          org_id: string
          paid_on?: string
          party_id: string
          reference_no?: string | null
        }
        Update: {
          amount_minor?: number
          attachment_path?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          direction?: string
          id?: string
          method?: string
          notes?: string | null
          org_id?: string
          paid_on?: string
          party_id?: string
          reference_no?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          org_id: string
          role: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          org_id: string
          role?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          org_id?: string
          role?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      activity_margin: {
        Row: {
          activity_id: string | null
          activity_type_id: string | null
          currency: string | null
          direct_cost_minor: number | null
          direction: string | null
          margin_minor: number | null
          occurred_on: string | null
          org_id: string | null
          party_id: string | null
          revenue_minor: number | null
          status: string | null
          uses_job_margin: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_activity_type_id_fkey"
            columns: ["activity_type_id"]
            isOneToOne: false
            referencedRelation: "activity_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_type_direction_fk"
            columns: ["activity_type_id", "direction"]
            isOneToOne: false
            referencedRelation: "activity_types"
            referencedColumns: ["id", "direction"]
          },
          {
            foreignKeyName: "activities_type_org_fk"
            columns: ["activity_type_id", "org_id"]
            isOneToOne: false
            referencedRelation: "activity_types"
            referencedColumns: ["id", "org_id"]
          },
        ]
      }
      credit_balances: {
        Row: {
          applied_minor: number | null
          counterparty_id: string | null
          currency: string | null
          direction: string | null
          doc_kind: string | null
          doc_no: string | null
          document_id: string | null
          org_id: string | null
          total_minor: number | null
          unapplied_minor: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      document_balances: {
        Row: {
          balance_due_minor: number | null
          counterparty_id: string | null
          credited_minor: number | null
          currency: string | null
          direction: string | null
          doc_date: string | null
          doc_kind: string | null
          doc_no: string | null
          document_id: string | null
          due_date: string | null
          org_id: string | null
          party_doc_no: string | null
          settled_minor: number | null
          total_minor: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      party_outstanding: {
        Row: {
          amount_outstanding_minor: number | null
          amount_overdue_minor: number | null
          currency: string | null
          direction: string | null
          documents_outstanding: number | null
          documents_overdue: number | null
          org_id: string | null
          party_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_counterparty_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      party_ready_to_bill: {
        Row: {
          currency: string | null
          direction: string | null
          org_id: string | null
          party_id: string | null
          pending_amount_minor: number | null
          pending_count: number | null
        }
        Relationships: [
          {
            foreignKeyName: "activities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_balances: {
        Row: {
          amount_minor: number | null
          applied_minor: number | null
          currency: string | null
          direction: string | null
          org_id: string | null
          paid_on: string | null
          party_id: string | null
          payment_id: string | null
          unapplied_minor: number | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "parties"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      allocate: {
        Args: {
          p_amount_minor: number
          p_credit_document_id?: string
          p_payment_id?: string
          p_target_document_id: string
        }
        Returns: {
          allocation_id: string
        }[]
      }
      apply_industry_template: {
        Args: { p_template_key: string }
        Returns: {
          types_added: number
        }[]
      }
      cancel_document: {
        Args: { p_document_id: string; p_reason: string }
        Returns: {
          document_id: string
        }[]
      }
      create_organisation: {
        Args: {
          p_address?: string
          p_base_currency: string
          p_country_code: string
          p_credit_note_prefix?: string
          p_default_tax_rate_pct?: number
          p_fiscal_year_start_month?: number
          p_full_name?: string
          p_invoice_prefix?: string
          p_legal_name: string
          p_locale?: string
          p_region_code?: string
          p_tax_id?: string
          p_tax_id_kind?: string
          p_tax_regime?: string
          p_timezone?: string
        }
        Returns: {
          org_id: string
        }[]
      }
      current_org_id: { Args: never; Returns: string }
      current_role_name: { Args: never; Returns: string }
      fiscal_year_code: {
        Args: { p_date: string; p_start_month: number }
        Returns: string
      }
      has_role: { Args: { p_roles: string[] }; Returns: boolean }
      issue_document: {
        Args: {
          p_activity_ids?: string[]
          p_counterparty_id: string
          p_counterparty_override_reason?: string
          p_doc_date: string
          p_doc_kind: string
          p_due_date?: string
          p_free_lines?: Json
          p_notes?: string
          p_party_doc_no?: string
          p_ship_to_party_id?: string
          p_tax_treatment?: string
          p_taxable_value_minor: number
          p_taxes?: Json
          p_total_minor: number
        }
        Returns: {
          doc_no: string
          document_id: string
        }[]
      }
      next_doc_number: {
        Args: { p_doc_date: string; p_doc_kind: string }
        Returns: string
      }
      period_key_for: {
        Args: {
          p_date: string
          p_fy_start_month: number
          p_reset_cadence: string
        }
        Returns: string
      }
      rebuild_dimensions: {
        Args: { p_activity_type_id: string }
        Returns: {
          rebuilt_count: number
        }[]
      }
      record_activity: {
        Args: {
          p_activity_type_id: string
          p_amount_minor: number
          p_bill_to_party_id?: string
          p_details?: Json
          p_direct_cost_minor?: number
          p_notes?: string
          p_occurred_on: string
          p_party_id: string
          p_period_end?: string
          p_period_start?: string
          p_reference?: string
          p_status?: string
        }
        Returns: {
          activity_id: string
        }[]
      }
      record_payment: {
        Args: {
          p_allocations?: Json
          p_amount_minor: number
          p_direction: string
          p_method: string
          p_notes?: string
          p_paid_on: string
          p_party_id: string
          p_reference_no?: string
        }
        Returns: {
          payment_id: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const

