import { redirect } from "next/navigation";

/** `/platform` nije ekran; vodi na listu firmi. */
export default function PlatformIndex() {
  redirect("/platform/firme");
}
