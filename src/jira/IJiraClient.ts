export interface JiraIssue {
  key: string;
  summary: string;
  status: string;
  priority: string;
  dueDate: string | undefined;
  issueType: string;
  url: string;
}

export interface IJiraClient {
  /** Open (not-Done) issues assigned to the token owner in the configured project. */
  getMyOpenIssues(): Promise<JiraIssue[]>;
}
