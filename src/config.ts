import { version } from "../package.json";

export const APP_VERSION = version;
export const CLOUD_MODE = import.meta.env.VITE_STORAGE_MODE !== "local";
