export const app = {
  getPath(): never { throw new Error("Native Electron paths are forbidden in this safety fixture"); }
};
