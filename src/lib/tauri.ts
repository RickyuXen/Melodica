export type AppInfo = {
  name: string;
  version: string;
};

export async function getAppInfo(): Promise<AppInfo> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AppInfo>("app_info");
}
