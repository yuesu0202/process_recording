// ffprobe-static ships no types. It exports the path to the bundled ffprobe binary.
declare module "ffprobe-static" {
  const ffprobe: { path: string };
  export default ffprobe;
}
