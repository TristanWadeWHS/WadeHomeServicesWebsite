import { ServicePage } from "../components/ServicePage";
import { services } from "../lib/siteContent";

export default function StorageRelocation() {
  return <ServicePage service={services[2]} />;
}
