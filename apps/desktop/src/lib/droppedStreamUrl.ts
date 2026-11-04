import { parseStreamUrl } from "./platformParser";

export function droppedStreamUrl(data: Pick<DataTransfer, "getData">) {
  const uri = data
    .getData("text/uri-list")
    .split(/\r?\n/)
    .find((line) => line.trim() && !line.startsWith("#"));
  const text = (uri || data.getData("text/plain")).trim();
  if (!/^https?:\/\/\S+$/i.test(text)) return null;
  return parseStreamUrl(text);
}
