export const apiBaseUrl =
  import.meta.env.VITE_DIDITBREAK_API_URL?.replace(/\/$/, "") || "http://127.0.0.1:4000";
