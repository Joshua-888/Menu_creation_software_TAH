import { redirect } from "next/navigation";
import { getCurrentEmployee } from "../lib/session";

export default async function HomePage() {
  const emp = await getCurrentEmployee();
  redirect(emp ? "/jobs" : "/login");
}
