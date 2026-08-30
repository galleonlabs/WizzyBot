/** Public Wizzy Privy application identifier. The app secret is server-only. */
export const DEFAULT_PRIVY_APP_ID = "cmtft1kti01cf0dl73c3zpuem";

export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? DEFAULT_PRIVY_APP_ID;
