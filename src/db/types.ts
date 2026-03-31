export type SessionStatus = "online" | "offline" | "waiting" | "idle";

export interface Project {
  channel_id: string;
  project_path: string;
  guild_id: string;
  auto_approve: number; // 0 or 1
  created_at: string;
}

export interface Session {
  id: string;
  channel_id: string;
  session_id: string | null; // Claude Agent SDK session ID
  status: SessionStatus;
  last_activity: string | null;
  created_at: string;
}
