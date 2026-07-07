import type { IJiraClient, JiraIssue } from "./IJiraClient.js";

export interface JiraClientOptions {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

interface JiraSearchResponseIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    priority: { name: string } | null;
    duedate: string | null;
    issuetype: { name: string };
  };
}

interface JiraSearchResponse {
  issues: JiraSearchResponseIssue[];
}

/**
 * Thin wrapper over the Jira Cloud REST API v3 search endpoint. Uses Basic
 * Auth (email + API token, per Atlassian Cloud's auth model) - no OAuth
 * app registration needed for a single personal token.
 */
export class JiraClient implements IJiraClient {
  constructor(private readonly options: JiraClientOptions) {}

  async getMyOpenIssues(): Promise<JiraIssue[]> {
    const jql = `project = "${this.options.projectKey}" AND assignee = currentUser() AND statusCategory != Done ORDER BY priority DESC, duedate ASC`;

    const params = new URLSearchParams({
      jql,
      fields: "summary,status,priority,duedate,issuetype",
      maxResults: "50",
    });

    const url = `${this.options.baseUrl}/rest/api/3/search/jql?${params.toString()}`;
    const auth = Buffer.from(
      `${this.options.email}:${this.options.apiToken}`,
    ).toString("base64");

    const response = await fetch(url, {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Jira search failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as JiraSearchResponse;

    return data.issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status.name,
      priority: issue.fields.priority?.name ?? "미지정",
      dueDate: issue.fields.duedate ?? undefined,
      issueType: issue.fields.issuetype.name,
      url: `${this.options.baseUrl}/browse/${issue.key}`,
    }));
  }
}
