/** Public links; a link that isn't set yet is left out of the footer. */
export const LINKS = {
  repo: process.env.NEXT_PUBLIC_REPO_URL ?? "",
  docs: process.env.NEXT_PUBLIC_DOCS_URL ?? "",
  x: process.env.NEXT_PUBLIC_X_URL ?? "",
};
