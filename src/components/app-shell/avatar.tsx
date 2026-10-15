/**
 * A person: a grey 300 disc (`input`, the photo's placeholder: it stays
 * a disc on the selected row's grey) of initials in the ink, or their
 * photo when the organisation shows photos and one was read from the CV
 * (`photoUrl`, a signed URL). Every photo is shown in greyscale (the
 * `photo` utility): identification stays, colour goes. The initials stay
 * under the photo until it has loaded, then the photo fades in; a photo
 * that fails leaves the initials. The photo identifies a person in the
 * interface only: it never reaches a model. `profile` is the
 * square-rounded variant of a candidate sheet. On its own the avatar is
 * an image named after the person; next to the visible name it is
 * `decorative`, so a screen reader does not read the name twice. A
 * muted `Row` fades it through its `data-slot`.
 */
import { useState } from "react";

import { initialsOf } from "@/lib/org/org-context";
import { cn } from "@/lib/utils";

export type AvatarSize = "sm" | "md" | "lg" | "xl";

const SIZES: Record<AvatarSize, string> = {
  sm: "size-7 text-xs",
  md: "size-9 text-xs",
  lg: "size-11 text-sm",
  xl: "size-18 text-lg",
};

const PROFILE_RADII: Record<AvatarSize, string> = {
  sm: "rounded-sm",
  md: "rounded-sm",
  lg: "rounded-md",
  xl: "rounded-lg",
};

/** The photo layer: hidden until the URL it shows has loaded, so a new URL starts hidden again. */
function Photo({ url, onFailed }: { url: string; onFailed: () => void }) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const loaded = loadedUrl === url;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      onLoad={() => setLoadedUrl(url)}
      onError={onFailed}
      className={cn(
        "photo absolute inset-0 size-full object-cover transition-opacity duration-slow ease-out-soft",
        loaded ? "opacity-100" : "opacity-0",
      )}
    />
  );
}

export function Avatar({
  name,
  size = "md",
  className,
  photoUrl,
  variant = "disc",
  decorative = false,
}: {
  name: string;
  size?: AvatarSize;
  className?: string;
  /** A signed URL of the person's photo; null or absent shows the initials. */
  photoUrl?: string | null | undefined;
  /** `profile`: square with rounded corners, for a candidate sheet. */
  variant?: "disc" | "profile";
  /** True where the person's name is shown beside the avatar: hidden from assistive technologies. */
  decorative?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = photoUrl && photoUrl !== failedUrl ? photoUrl : null;
  return (
    <span
      data-slot="avatar"
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden bg-input font-semibold text-ink",
        variant === "profile" ? PROFILE_RADII[size] : "rounded-full",
        SIZES[size],
        className,
      )}
      {...(decorative ? { "aria-hidden": true } : { role: "img", title: name, "aria-label": name })}
    >
      <span aria-hidden="true">{initialsOf(name)}</span>
      {url ? <Photo url={url} onFailed={() => setFailedUrl(url)} /> : null}
    </span>
  );
}
