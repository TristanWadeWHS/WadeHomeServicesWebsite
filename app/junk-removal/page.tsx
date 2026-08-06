import { ServicePage } from "../components/ServicePage";
import { services } from "../lib/siteContent";

export default function JunkRemoval() {
  return <ServicePage service={services[0]} />;
}
