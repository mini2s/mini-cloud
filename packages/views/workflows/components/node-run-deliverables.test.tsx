import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NodeRunDeliverables } from "./node-run-deliverables";

vi.mock("@multica/core/api", () => ({
  api: {
    listNodeRunDeliverableSubmissions: vi.fn(),
  },
}));

// Stub the upload mutations so the component test stays isolated from
// useWorkspaceId / the real API client. mutateMock records the submitted body.
const docMutateMock = vi.fn();
const prMutateMock = vi.fn();
vi.mock("@multica/core/issues/mutations", () => ({
  useUploadIssueDeliverable: vi.fn(() => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: (files: { name: string; content: string }[], opts?: { onSuccess?: () => void }) => {
      docMutateMock(files);
      opts?.onSuccess?.();
    },
  })),
  useUploadIssueDeliverablePR: vi.fn(() => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: (url: string, opts?: { onSuccess?: () => void }) => {
      prMutateMock(url);
      opts?.onSuccess?.();
    },
  })),
}));

vi.mock("../../i18n", () => {
  const translations = {
    node_run: {
      deliverables: {
        heading: "Deliverable PRs",
        document_section: "Documents",
        code_section: "Code",
        pull_request_label: "Pull request",
        upload_button: "Upload deliverable",
        upload_heading: "Submit a document",
        upload_file_hint: "md/txt",
        upload_file_choose: "Choose a file",
        upload_pr_button: "Submit merge request",
        upload_pr_heading: "Submit a merge request link",
        upload_pr_placeholder: "paste URL",
        upload_pr_submit: "Submit link",
        cancel: "Cancel",
        uploading: "Submitting…",
      },
    },
  };
  return {
    useT: () => ({
      t: (selector: (value: typeof translations) => string) => selector(translations),
    }),
  };
});

import { api } from "@multica/core/api";

function withClient(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const EMPTY = { submissions: [], deliverables: [] };

describe("NodeRunDeliverables", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a PR link for a submission with pull_request_url", async () => {
    vi.mocked(api.listNodeRunDeliverableSubmissions).mockResolvedValue({
      submissions: [
        {
          id: "sub-1",
          workflow_node_run_id: "nr-1",
          deliverable_id: "d-1",
          submitted_by_type: "agent",
          submitted_by_id: null,
          status: "submitted",
          content: "",
          attachment_id: null,
          pull_request_url: "https://gitea.test/t-aaa/wf-bbb/pulls/7",
          review_comment: "",
          submitted_at: "2026-07-18T00:00:00Z",
          reviewed_at: null,
          created_at: "2026-07-18T00:00:00Z",
          updated_at: "2026-07-18T00:00:00Z",
        },
      ],
      deliverables: [{ id: "d-1", workflow_node_id: "n-1", kind: "document", title: "Doc", description: "", required: true, sort_order: 0, created_at: "", updated_at: "" }],
    });
    withClient(<NodeRunDeliverables wsId="ws-1" nodeRunId="nr-1" />);

    const link = await screen.findByRole("link", { name: /pull request/i });
    expect(link).toHaveAttribute("href", "https://gitea.test/t-aaa/wf-bbb/pulls/7");
  });

  it("renders nothing when no submissions, no deliverables, and not uploadable", async () => {
    vi.mocked(api.listNodeRunDeliverableSubmissions).mockResolvedValue(EMPTY);
    const { container } = withClient(<NodeRunDeliverables wsId="ws-1" nodeRunId="nr-1" />);
    await waitFor(() =>
      expect(api.listNodeRunDeliverableSubmissions).toHaveBeenCalledTimes(1),
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows a file picker for a document deliverable on a human-worker node run", async () => {
    vi.mocked(api.listNodeRunDeliverableSubmissions).mockResolvedValue({
      submissions: [],
      deliverables: [{ id: "d-1", workflow_node_id: "n-1", kind: "document", title: "Doc", description: "", required: true, sort_order: 0, created_at: "", updated_at: "" }],
    });
    const { container } = withClient(
      <NodeRunDeliverables wsId="ws-1" nodeRunId="nr-1" issueId="issue-1" canUpload />,
    );

    const openBtn = await screen.findByRole("button", { name: /upload deliverable/i });
    fireEvent.click(openBtn);

    // Document kind → a file input (not a textarea).
    await waitFor(() => {
      expect(container.querySelector('input[type="file"]')).not.toBeNull();
    });
  });

  it("submits a code PR link via the URL input for a pull_request deliverable", async () => {
    vi.mocked(api.listNodeRunDeliverableSubmissions).mockResolvedValue({
      submissions: [],
      deliverables: [{ id: "d-2", workflow_node_id: "n-1", kind: "pull_request", title: "Code", description: "", required: true, sort_order: 0, created_at: "", updated_at: "" }],
    });
    withClient(
      <NodeRunDeliverables wsId="ws-1" nodeRunId="nr-1" issueId="issue-1" canUpload />,
    );

    const openBtn = await screen.findByRole("button", { name: /submit merge request/i });
    fireEvent.click(openBtn);

    const urlInput = await screen.findByPlaceholderText(/paste URL/i);
    fireEvent.change(urlInput, { target: { value: "https://git.example/pr/9" } });

    const submit = screen.getByRole("button", { name: /submit link/i });
    fireEvent.click(submit);

    await waitFor(() => expect(prMutateMock).toHaveBeenCalledWith("https://git.example/pr/9"));
  });

  it("does not show the upload control when canUpload is false", async () => {
    vi.mocked(api.listNodeRunDeliverableSubmissions).mockResolvedValue({
      submissions: [],
      deliverables: [{ id: "d-1", workflow_node_id: "n-1", kind: "document", title: "Doc", description: "", required: true, sort_order: 0, created_at: "", updated_at: "" }],
    });
    withClient(
      <NodeRunDeliverables wsId="ws-1" nodeRunId="nr-1" issueId="issue-1" />,
    );
    await waitFor(() =>
      expect(api.listNodeRunDeliverableSubmissions).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByRole("button", { name: /upload deliverable/i })).toBeNull();
  });
});
