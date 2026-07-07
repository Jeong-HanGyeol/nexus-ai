/** Maps Node's process.platform to the spec's platform vocabulary (windows | macos | linux). */
export function platformLabel(nodePlatform: NodeJS.Platform): string {
  switch (nodePlatform) {
    case "win32":
      return "windows";
    case "darwin":
      return "macos";
    case "linux":
      return "linux";
    default:
      return nodePlatform;
  }
}
