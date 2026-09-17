import { redirect } from "react-router";

export function loader() {
  throw redirect("/org/projects");
}

export default function OrgIndex() {
  return null;
}
