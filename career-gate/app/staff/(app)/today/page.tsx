import { redirect } from "next/navigation";

export default function TodayRoute() {
  redirect("/staff?tab=today");
}
