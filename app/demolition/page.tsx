import { ServicePage } from "../components/ServicePage";
import { services } from "../lib/siteContent";

export default function Demolition() {
  return <ServicePage service={services[1]} />;
}
