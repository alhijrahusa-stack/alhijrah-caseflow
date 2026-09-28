import { redirect } from "next/navigation";

export default function SettingsRoute() {
  redirect("/staff?tab=settings");
}
