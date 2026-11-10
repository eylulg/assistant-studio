import { Studio } from "@/components/studio";
import { serverConfig } from "@/lib/config";

// The demo banner depends on an environment variable, so this page is rendered per request.
export const dynamic = "force-dynamic";

export default function Page() {
    return <Studio demo={!serverConfig().apiKey} />;
}
