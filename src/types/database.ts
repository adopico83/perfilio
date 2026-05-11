export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      bicho_notifications: {
        Row: {
          id: string;
          created_at: string;
          type: string;
          slug: string;
          content_hash: string | null;
          urgency: 'alta' | 'media' | 'baja';
          user_feedback: string | null;
          metadata: Json | null;
          is_read: boolean;
          message: string;
        };
        Insert: {
          id?: string;
          created_at?: string;
          type: string;
          slug: string;
          content_hash?: string | null;
          urgency: 'alta' | 'media' | 'baja';
          user_feedback?: string | null;
          metadata?: Json | null;
          is_read?: boolean;
          message: string;
        };
        Update: {
          id?: string;
          created_at?: string;
          type?: string;
          slug?: string;
          content_hash?: string | null;
          urgency?: 'alta' | 'media' | 'baja';
          user_feedback?: string | null;
          metadata?: Json | null;
          is_read?: boolean;
          message?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
