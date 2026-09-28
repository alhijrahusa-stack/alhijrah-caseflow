import { redirect } from "next/navigation";

export default function WeekRoute() {
  redirect("/staff?tab=week");
}
