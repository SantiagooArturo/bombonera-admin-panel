/**
 * Decide si un `href` debe abrirse en la misma pestaña (navegación dentro de esta plataforma).
 *
 * - Rutas desde raíz (`/ruta`, `/api/...`) del despliegue actual.
 * - Mismo origen que la ventana o `NEXT_PUBLIC_APP_URL` (URLs absolutas internas).
 * - `#fragmento` y `mailto:` / `tel:` / `sms:` (no reemplazan la vista SPA de forma equivalente a un `https` externo).
 */

function resolveAppOrigin(explicit?: string): string {
  const fromArg = explicit?.trim();
  if (fromArg) {
    try {
      return new URL(fromArg).origin;
    } catch {
      /* ignore */
    }
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (env) {
    try {
      return new URL(env).origin;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export function isPlatformInternalHref(href: string, options?: { origin?: string }): boolean {
  const trimmed = href.trim();
  if (!trimmed) return true;

  if (trimmed.startsWith("#")) return true;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("mailto:") || lower.startsWith("tel:") || lower.startsWith("sms:")) {
    return true;
  }

  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return true;
  }

  const appOrigin = resolveAppOrigin(options?.origin);
  if (!appOrigin) {
    return false;
  }

  try {
    const resolved = new URL(trimmed, appOrigin);
    return resolved.origin === new URL(appOrigin).origin;
  } catch {
    return false;
  }
}

/** Props para `<a>`: nueva pestaña solo fuera de la plataforma. */
export function anchorPropsForHref(href: string | null | undefined): {
  target?: string;
  rel?: string;
} {
  if (href == null || !String(href).trim()) return {};
  if (isPlatformInternalHref(String(href))) return {};
  return { target: "_blank", rel: "noopener noreferrer" };
}

/** Navegación programática alineada con la regla misma pestaña / nueva pestaña. */
export function navigateToHref(href: string): void {
  if (typeof window === "undefined") return;
  if (isPlatformInternalHref(href)) {
    window.location.assign(href);
    return;
  }
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.click();
}
