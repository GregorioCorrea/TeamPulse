import { ClientSecretCredential } from "@azure/identity";
import fetch from "node-fetch";

const GRAPH_SCOPE = "https://graph.microsoft.com/.default";

interface GraphUser {
  id: string;
  displayName: string;
  mail?: string;
  userPrincipalName: string;
}

export interface DirectoryUserResult {
  id: string;
  displayName: string;
  email: string;
}

let credential: ClientSecretCredential | null = null;

function ensureCredential(): ClientSecretCredential | null {
  if (credential) return credential;

  const tenantId = process.env.GRAPH_CLIENT_TENANT_ID || process.env.MP_API_TENANT_ID;
  const clientId = process.env.GRAPH_CLIENT_ID || process.env.MP_API_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET || process.env.MP_API_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    console.warn("⚠️ Graph credentials not fully configured. Directory search will be disabled.");
    return null;
  }

  credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  return credential;
}

async function getGraphToken(): Promise<string | null> {
  const cred = ensureCredential();
  if (!cred) return null;

  const token = await cred.getToken(GRAPH_SCOPE);
  return token?.token || null;
}

export async function searchDirectoryUsers(query: string, tenantId?: string): Promise<DirectoryUserResult[]> {
  const trimmed = (query || "").trim();
  if (!trimmed) return [];

  try {
    if (process.env.NODE_ENV === "development" && !ensureCredential()) {
      // Provide mock data for local development when credentials are missing
      return [
        {
          id: "00000000-0000-0000-0000-000000000001",
          displayName: "Demo Admin",
          email: "demo.admin@contoso.com"
        },
        {
          id: "00000000-0000-0000-0000-000000000002",
          displayName: "Demo Manager",
          email: "manager.demo@contoso.com"
        }
      ];
    }

    const token = await getGraphToken();
    if (!token) {
      console.warn("⚠️ Directory search skipped: missing Graph token");
      return [];
    }

    const sanitized = trimmed.replace(/["']/g, "");
    const filter = `startswith(displayName,'${sanitized}') or startswith(mail,'${sanitized}') or startswith(userPrincipalName,'${sanitized}')`;
    const url = new URL("https://graph.microsoft.com/v1.0/users");
    url.searchParams.set("$select", "id,displayName,mail,userPrincipalName");
    url.searchParams.set("$top", "10");
    url.searchParams.set("$filter", filter);

    if (tenantId) {
      console.log(`🔎 [GRAPH] Searching directory in tenant ${tenantId}`);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("❌ Graph search failed:", response.status, text);
      return [];
    }

    const payload = (await response.json()) as { value?: GraphUser[] };
    const users = payload.value || [];

    return users.map((user) => ({
      id: user.id,
      displayName: user.displayName,
      email: user.mail || user.userPrincipalName
    }));
  } catch (error) {
    console.error("❌ Error searching directory users:", error);
    return [];
  }
}
