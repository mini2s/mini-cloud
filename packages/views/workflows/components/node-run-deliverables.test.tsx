import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NodeRunDeliverables } from "./node-run-deliverables";

vi.mock("@multica/core/api", () => ({
  api: {
    listNodeRunDeliverableSubmissions: vi.fn(),
    uploadIssueDeliverable: vi.fn(),
  },
}));

// Stub the upload mutation so the component test stays isolated from
// useWorkspaceId / the real API client. mutateMock records the submitted body.
const mutateMock = vi.fn();
vi.mock("@multica/core/issues/mutations", () => ({
  useUploadIssueDeliverable: vi.fn(() => ({
    isPending: false,
    isError: false,
    error: null,
    mutate: (content: string, opts?: { onSuccess?: () => void }) => {
      mutateMock(content);
      opts?.onSuccess?.();
    },
  })),
}));

vi.mock("../../i18n", () => {
  const translations = {
    node_run: {
      deliverables: {
        heading: "Deliverable PRs",
        pull_request_label: "Pull request",
        upload_button: "Upload deliverable",
        upload_heading: "Submit a document",
        upload_placeholder: "markdown…",
        upload_submit: "Submit",
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

describe("NodeRunDeliverables", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders a PR link for a submission with pull_request_url", async () => {
    vi.mocked(api.listNodeRunDeliverableSubmissions).mockResolvedValue([
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
    ]);
    withClient(<NodeRunDeliverables wsId="ws-1" nodeRunId="nr-1" />);

    const link = await screen.findByRole("link", { name: /pull request/i });
    expect(link).toHaveAttribute("href", "https://gitea.test/t-aaa/wf-bbb/pulls/7");
  });

  it("renders no PR link when there are no submissions", async () => {
    vi.mocked(api.listNodeRunDeliverableSubmissions).mockResolvedValue([]);
    withClient(<NodeRunDeliverables wsId="ws-1" nodeRunId="nr-1" />);
    await waitFor(() => {
      expect(api.listNodeRunDeliverableSubmissions).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  it("renders nothing when no submissions and not uploadable", async () => {
    vi.mocked(api.listNodeRunDeliverableSubmissions).mockResolvedValue([]);
    const { container } = withClient(
      <NodeRunDeliverables wsId="ws-1" nodeRunId="nr-1" />,
    );
    await waitFor(() =>
      expect(api.listNodeRunDeliverableSubmissions).toHaveBeenCalledTimes(1),
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows the upload control for a human-worker node run (canUpload + issueId)", async () => {
    vi.mocked(api.listNodeRunDeliverableSubmissions).mockResolvedValue([]);
    withClient(
      <NodeRunDeliverables wsId="ws-1" nodeRunId="nr-1" issueId="issue-1" canUpload />,
    );

    const openBtn = await screen.findByRole("button", { name: /upload deliverable/i });
    fireEvent.click(openBtn);

    const textarea = await screen.findByPlaceholderText(/markdown/i);
    fireEvent.change(textarea, { target: { value: "# Hello\n\nBody." } });

    const submit = screen.getByRole("button", { name: /submit/i });
    fireEvent.click(submit);

    await waitFor(() => expect(mutateMock).toHaveBeenCalledWith("# Hello\n\nBody."));
  });

  it("does not show the upload control when canUpload is false", async () => {
    vi.mocked(api.listNodeRunDeliverableSubmissions).mockResolvedValue([]);
    withClient(
      <NodeRunDeliverables wsId="ws-1" nodeRunId="nr-1" issueId="issue-1" />,
    );
    await waitFor(() =>
      expect(api.listNodeRunDeliverableSubmissions).toHaveBeenCalledTimes(1),
    );
    expect(screen.queryByRole("button", { name: /upload deliverable/i })).toBeNull();
  });
});
