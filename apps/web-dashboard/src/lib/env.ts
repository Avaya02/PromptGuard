export const apiBaseUrl =
  import.meta.env.VITE_PROMPTGUARD_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:4000";
