import { MulticaIcon } from "@multica/ui/components/common/multica-icon";

export default function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <MulticaIcon className="size-6 animate-pulse" />
    </div>
  );
}
