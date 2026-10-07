export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/**
 * Database types for Structra.
 *
 * GENERATED from the applied schema - do not edit by hand.
 *
 * Regenerate after any schema change with:
 *   npx supabase gen types typescript --project-id <project-ref> > lib/supabase/types.ts
 *
 * `Database` is the only export consumed by the clients in this folder, so
 * regenerating requires no other code changes.
 */
export type Database = {
  public: {
    Tables: {
      grocery_items: {
        Row: {
          id: string;
          grocery_list_id: string;
          name: string;
          quantity: number | null;
          unit: Database["public"]["Enums"]["grocery_unit"] | null;
          completed: boolean;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string | null;
          grocery_list_id: string;
          name: string;
          quantity?: number | null;
          unit?: Database["public"]["Enums"]["grocery_unit"] | null;
          completed?: boolean | null;
          notes?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string | null;
          grocery_list_id?: string | null;
          name?: string | null;
          quantity?: number | null;
          unit?: Database["public"]["Enums"]["grocery_unit"] | null;
          completed?: boolean | null;
          notes?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "grocery_items_grocery_list_id_fkey",
            columns: ["grocery_list_id"],
            isOneToOne: false,
            referencedRelation: "grocery_lists",
            referencedColumns: ["id"],
          }
        ];
      };
      grocery_lists: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string | null;
          workspace_id: string;
          name: string;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string | null;
          workspace_id?: string | null;
          name?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "grocery_lists_workspace_id_fkey",
            columns: ["workspace_id"],
            isOneToOne: false,
            referencedRelation: "workspaces",
            referencedColumns: ["id"],
          }
        ];
      };
      habit_completions: {
        Row: {
          id: string;
          habit_id: string;
          workspace_id: string;
          user_id: string;
          completed_on: string;
          created_at: string;
        };
        Insert: {
          id?: string | null;
          habit_id: string;
          workspace_id: string;
          user_id: string;
          completed_on: string;
          created_at?: string | null;
        };
        Update: {
          id?: string | null;
          habit_id?: string | null;
          workspace_id?: string | null;
          user_id?: string | null;
          completed_on?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "habit_completions_habit_fk",
            columns: ["workspace_id", "habit_id"],
            isOneToOne: false,
            referencedRelation: "habits",
            referencedColumns: ["workspace_id", "id"],
          },
          {
            foreignKeyName: "habit_completions_user_id_fkey",
            columns: ["user_id"],
            isOneToOne: false,
            referencedRelation: "users",
            referencedColumns: ["id"],
          },
          {
            foreignKeyName: "habit_completions_workspace_id_fkey",
            columns: ["workspace_id"],
            isOneToOne: false,
            referencedRelation: "workspaces",
            referencedColumns: ["id"],
          }
        ];
      };
      habits: {
        Row: {
          id: string;
          workspace_id: string;
          created_by: string;
          name: string;
          description: string | null;
          frequency: Database["public"]["Enums"]["habit_frequency"];
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string | null;
          workspace_id: string;
          created_by: string;
          name: string;
          description?: string | null;
          frequency?: Database["public"]["Enums"]["habit_frequency"] | null;
          created_at?: string | null;
          updated_at?: string | null;
          archived_at?: string | null;
        };
        Update: {
          id?: string | null;
          workspace_id?: string | null;
          created_by?: string | null;
          name?: string | null;
          description?: string | null;
          frequency?: Database["public"]["Enums"]["habit_frequency"] | null;
          created_at?: string | null;
          updated_at?: string | null;
          archived_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "habits_created_by_fkey",
            columns: ["created_by"],
            isOneToOne: false,
            referencedRelation: "users",
            referencedColumns: ["id"],
          },
          {
            foreignKeyName: "habits_workspace_id_fkey",
            columns: ["workspace_id"],
            isOneToOne: false,
            referencedRelation: "workspaces",
            referencedColumns: ["id"],
          }
        ];
      };
      notes: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          title: string;
          content: string | null;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string | null;
          workspace_id: string;
          user_id: string;
          title: string;
          content?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          archived_at?: string | null;
        };
        Update: {
          id?: string | null;
          workspace_id?: string | null;
          user_id?: string | null;
          title?: string | null;
          content?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          archived_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "notes_user_id_fkey",
            columns: ["user_id"],
            isOneToOne: false,
            referencedRelation: "users",
            referencedColumns: ["id"],
          },
          {
            foreignKeyName: "notes_workspace_id_fkey",
            columns: ["workspace_id"],
            isOneToOne: false,
            referencedRelation: "workspaces",
            referencedColumns: ["id"],
          }
        ];
      };
      otp_challenges: {
        Row: {
          id: string;
          email: string;
          purpose: Database["public"]["Enums"]["otp_purpose"];
          code_digest: string;
          attempts: number;
          max_attempts: number;
          expires_at: string;
          verified_at: string | null;
          consumed_at: string | null;
          request_ip: string | null;
          created_at: string;
        };
        Insert: {
          id?: string | null;
          email: string;
          purpose?: Database["public"]["Enums"]["otp_purpose"] | null;
          code_digest: string;
          attempts?: number | null;
          max_attempts?: number | null;
          expires_at: string;
          verified_at?: string | null;
          consumed_at?: string | null;
          request_ip?: string | null;
          created_at?: string | null;
        };
        Update: {
          id?: string | null;
          email?: string | null;
          purpose?: Database["public"]["Enums"]["otp_purpose"] | null;
          code_digest?: string | null;
          attempts?: number | null;
          max_attempts?: number | null;
          expires_at?: string | null;
          verified_at?: string | null;
          consumed_at?: string | null;
          request_ip?: string | null;
          created_at?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          avatar_url: string | null;
          timezone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          display_name?: string | null;
          avatar_url?: string | null;
          timezone?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string | null;
          display_name?: string | null;
          avatar_url?: string | null;
          timezone?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_id_fkey",
            columns: ["id"],
            isOneToOne: true,
            referencedRelation: "users",
            referencedColumns: ["id"],
          }
        ];
      };
      record_categories: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string | null;
          workspace_id: string;
          name: string;
          description?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string | null;
          workspace_id?: string | null;
          name?: string | null;
          description?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "record_categories_workspace_id_fkey",
            columns: ["workspace_id"],
            isOneToOne: false,
            referencedRelation: "workspaces",
            referencedColumns: ["id"],
          }
        ];
      };
      record_types: {
        Row: {
          id: string;
          workspace_id: string | null;
          name: string;
          description: string | null;
          created_by: string | null;
          configuration: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string | null;
          workspace_id?: string | null;
          name: string;
          description?: string | null;
          created_by?: string | null;
          configuration?: Json | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string | null;
          workspace_id?: string | null;
          name?: string | null;
          description?: string | null;
          created_by?: string | null;
          configuration?: Json | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "record_types_created_by_fkey",
            columns: ["created_by"],
            isOneToOne: false,
            referencedRelation: "users",
            referencedColumns: ["id"],
          },
          {
            foreignKeyName: "record_types_workspace_id_fkey",
            columns: ["workspace_id"],
            isOneToOne: false,
            referencedRelation: "workspaces",
            referencedColumns: ["id"],
          }
        ];
      };
      records: {
        Row: {
          id: string;
          workspace_id: string;
          record_type_id: string;
          category_id: string | null;
          title: string;
          description: string | null;
          data: Json;
          created_by: string;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string | null;
          workspace_id: string;
          record_type_id: string;
          category_id?: string | null;
          title: string;
          description?: string | null;
          data?: Json | null;
          created_by: string;
          created_at?: string | null;
          updated_at?: string | null;
          archived_at?: string | null;
        };
        Update: {
          id?: string | null;
          workspace_id?: string | null;
          record_type_id?: string | null;
          category_id?: string | null;
          title?: string | null;
          description?: string | null;
          data?: Json | null;
          created_by?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
          archived_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "records_category_id_fkey",
            columns: ["category_id"],
            isOneToOne: false,
            referencedRelation: "record_categories",
            referencedColumns: ["id"],
          },
          {
            foreignKeyName: "records_created_by_fkey",
            columns: ["created_by"],
            isOneToOne: false,
            referencedRelation: "users",
            referencedColumns: ["id"],
          },
          {
            foreignKeyName: "records_record_type_id_fkey",
            columns: ["record_type_id"],
            isOneToOne: false,
            referencedRelation: "record_types",
            referencedColumns: ["id"],
          },
          {
            foreignKeyName: "records_workspace_id_fkey",
            columns: ["workspace_id"],
            isOneToOne: false,
            referencedRelation: "workspaces",
            referencedColumns: ["id"],
          }
        ];
      };
      study_sessions: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          subject_id: string | null;
          topic: string | null;
          started_at: string;
          ended_at: string | null;
          duration_seconds: number | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string | null;
          workspace_id: string;
          user_id: string;
          subject_id?: string | null;
          topic?: string | null;
          started_at: string;
          ended_at?: string | null;
          duration_seconds?: number | null;
          notes?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string | null;
          workspace_id?: string | null;
          user_id?: string | null;
          subject_id?: string | null;
          topic?: string | null;
          started_at?: string | null;
          ended_at?: string | null;
          duration_seconds?: number | null;
          notes?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "study_sessions_subject_fk",
            columns: ["workspace_id", "subject_id"],
            isOneToOne: false,
            referencedRelation: "study_subjects",
            referencedColumns: ["workspace_id", "id"],
          },
          {
            foreignKeyName: "study_sessions_user_id_fkey",
            columns: ["user_id"],
            isOneToOne: false,
            referencedRelation: "users",
            referencedColumns: ["id"],
          },
          {
            foreignKeyName: "study_sessions_workspace_id_fkey",
            columns: ["workspace_id"],
            isOneToOne: false,
            referencedRelation: "workspaces",
            referencedColumns: ["id"],
          }
        ];
      };
      study_subjects: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string | null;
          workspace_id: string;
          name: string;
          description?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string | null;
          workspace_id?: string | null;
          name?: string | null;
          description?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "study_subjects_workspace_id_fkey",
            columns: ["workspace_id"],
            isOneToOne: false,
            referencedRelation: "workspaces",
            referencedColumns: ["id"],
          }
        ];
      };
      task_categories: {
        Row: {
          id: string;
          workspace_id: string;
          name: string;
          description: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string | null;
          workspace_id: string;
          name: string;
          description?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string | null;
          workspace_id?: string | null;
          name?: string | null;
          description?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "task_categories_workspace_id_fkey",
            columns: ["workspace_id"],
            isOneToOne: false,
            referencedRelation: "workspaces",
            referencedColumns: ["id"],
          }
        ];
      };
      task_category_links: {
        Row: {
          task_id: string;
          category_id: string;
          workspace_id: string;
          created_at: string;
        };
        Insert: {
          task_id: string;
          category_id: string;
          workspace_id: string;
          created_at?: string | null;
        };
        Update: {
          task_id?: string | null;
          category_id?: string | null;
          workspace_id?: string | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "task_category_links_category_fk",
            columns: ["workspace_id", "category_id"],
            isOneToOne: false,
            referencedRelation: "task_categories",
            referencedColumns: ["workspace_id", "id"],
          },
          {
            foreignKeyName: "task_category_links_task_fk",
            columns: ["workspace_id", "task_id"],
            isOneToOne: false,
            referencedRelation: "tasks",
            referencedColumns: ["workspace_id", "id"],
          },
          {
            foreignKeyName: "task_category_links_workspace_id_fkey",
            columns: ["workspace_id"],
            isOneToOne: false,
            referencedRelation: "workspaces",
            referencedColumns: ["id"],
          }
        ];
      };
      tasks: {
        Row: {
          id: string;
          workspace_id: string;
          created_by: string;
          title: string;
          description: string | null;
          status: Database["public"]["Enums"]["task_status"];
          priority: Database["public"]["Enums"]["task_priority"];
          due_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string | null;
          workspace_id: string;
          created_by: string;
          title: string;
          description?: string | null;
          status?: Database["public"]["Enums"]["task_status"] | null;
          priority?: Database["public"]["Enums"]["task_priority"] | null;
          due_at?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string | null;
          workspace_id?: string | null;
          created_by?: string | null;
          title?: string | null;
          description?: string | null;
          status?: Database["public"]["Enums"]["task_status"] | null;
          priority?: Database["public"]["Enums"]["task_priority"] | null;
          due_at?: string | null;
          completed_at?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "tasks_created_by_fkey",
            columns: ["created_by"],
            isOneToOne: false,
            referencedRelation: "users",
            referencedColumns: ["id"],
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey",
            columns: ["workspace_id"],
            isOneToOne: false,
            referencedRelation: "workspaces",
            referencedColumns: ["id"],
          }
        ];
      };
      user_settings: {
        Row: {
          user_id: string;
          theme: Database["public"]["Enums"]["app_theme"];
          preferences: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          theme?: Database["public"]["Enums"]["app_theme"] | null;
          preferences?: Json | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          user_id?: string | null;
          theme?: Database["public"]["Enums"]["app_theme"] | null;
          preferences?: Json | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "user_settings_user_id_fkey",
            columns: ["user_id"],
            isOneToOne: true,
            referencedRelation: "users",
            referencedColumns: ["id"],
          }
        ];
      };
      workspace_members: {
        Row: {
          id: string;
          workspace_id: string;
          user_id: string;
          role: Database["public"]["Enums"]["workspace_role"];
          created_at: string;
        };
        Insert: {
          id?: string | null;
          workspace_id: string;
          user_id: string;
          role?: Database["public"]["Enums"]["workspace_role"] | null;
          created_at?: string | null;
        };
        Update: {
          id?: string | null;
          workspace_id?: string | null;
          user_id?: string | null;
          role?: Database["public"]["Enums"]["workspace_role"] | null;
          created_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_user_id_fkey",
            columns: ["user_id"],
            isOneToOne: false,
            referencedRelation: "users",
            referencedColumns: ["id"],
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey",
            columns: ["workspace_id"],
            isOneToOne: false,
            referencedRelation: "workspaces",
            referencedColumns: ["id"],
          }
        ];
      };
      workspaces: {
        Row: {
          id: string;
          name: string;
          owner_id: string;
          is_personal: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string | null;
          name: string;
          owner_id: string;
          is_personal?: boolean | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Update: {
          id?: string | null;
          name?: string | null;
          owner_id?: string | null;
          is_personal?: boolean | null;
          created_at?: string | null;
          updated_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "workspaces_owner_id_fkey",
            columns: ["owner_id"],
            isOneToOne: true,
            referencedRelation: "users",
            referencedColumns: ["id"],
          }
        ];
      };
    };
    Views: {
      habit_current_streaks: {
        Row: {
          habit_id: string | null;
          user_id: string | null;
          current_streak: number | null;
          last_completed_on: string | null;
          is_active: boolean | null;
        };
        Relationships: [];
      };
      study_daily_totals: {
        Row: {
          workspace_id: string | null;
          user_id: string | null;
          subject_id: string | null;
          day: string | null;
          session_count: number | null;
          total_seconds: number | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_workspace_member: { Args: { target_workspace_id: string }; Returns: boolean };
      has_workspace_role: {
        Args: { target_workspace_id: string; allowed_roles: Database["public"]["Enums"]["workspace_role"][] };
        Returns: boolean;
      };
      is_workspace_owner: { Args: { target_workspace_id: string }; Returns: boolean };
      shares_workspace_with: { Args: { other_user_id: string }; Returns: boolean };
      can_access_grocery_list: { Args: { target_list_id: string }; Returns: boolean };
      backfill_missing_personal_workspaces: { Args: Record<PropertyKey, never>; Returns: number };
      purge_spent_otp_challenges: { Args: { older_than?: string }; Returns: number };
    };
    Enums: {
      app_theme: "ocean" | "crimson" | "light";
      grocery_unit: "kg" | "g" | "pieces" | "liters";
      habit_frequency: "daily" | "weekly";
      otp_purpose: "registration";
      task_priority: "low" | "medium" | "high";
      task_status: "todo" | "in_progress" | "blocked" | "done" | "archived";
      workspace_role: "owner" | "admin" | "member";
    };
    CompositeTypes: {
      [key: string]: never;
    };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type TablesInsert<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Update"];

export type Enums<T extends keyof Database["public"]["Enums"]> =
  Database["public"]["Enums"][T];
