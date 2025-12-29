export type Shift = {
  id: string;
  person_id: string;
  person_name_b64: string;
  start_at: string;
  end_at: string;
  created_at: string;
  updated_at: string;
};

export type Person = {
  id: string;
  person_name_b64: string;
  created_at: string;
  updated_at: string;
};

export type User = {
  id: string;
  username: string;
  person_name_b64: string;
  is_admin: boolean;
  created_at: string;
  updated_at: string;
};

export type AuditLog = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  actor_username: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  request_method: string;
  request_path: string;
  status_code: number;
};

export type Config = {
  serverUrl: string;
  username: string;
  token: string;
  refreshMinutes: number;
  userId: string;
  isAdmin: boolean;
};

export type SectionId =
  | "overview"
  | "shifts"
  | "people"
  | "users"
  | "audit"
  | "account";

export type NavItem = {
  id: SectionId;
  label: string;
  auth: boolean;
  admin: boolean;
};
