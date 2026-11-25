declare module "*.css";
/** Vite's `?url` import: the URL of the bundled asset. */
declare module "*?url" {
  const url: string;
  export default url;
}
