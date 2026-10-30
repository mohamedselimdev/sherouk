import { redirect } from "react-router";
import { DEFAULT_LOCALE } from "~/i18n/config";

export function loader() {
  return redirect(`/${DEFAULT_LOCALE}`, 302);
}
