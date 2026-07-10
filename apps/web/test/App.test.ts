/**
 * Component test for the walking skeleton's one real, interactive UI
 * element (plan 01-07): App.vue reads the live PersistenceCanary count on
 * mount and writes a new one via a button click.
 *
 * This test stubs the `api.ts` transport layer (`getCanary`/`createCanary`)
 * with `vi.mock` — it does NOT hit a real HTTP server or Postgres. The real
 * browser -> API -> DB round-trip is validated by the compose smoke test in
 * plan 01-08; this test is intentionally transport-mocked by design so it
 * runs fast and deterministically in the unit test suite.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App.vue";
import { createCanary, getCanary } from "../src/api";

vi.mock("../src/api", () => ({
  getCanary: vi.fn(),
  createCanary: vi.fn(),
}));

const mockedGetCanary = vi.mocked(getCanary);
const mockedCreateCanary = vi.mocked(createCanary);

beforeEach(() => {
  mockedGetCanary.mockReset();
  mockedCreateCanary.mockReset();
});

describe("App.vue", () => {
  it("renders the count fetched from GET /api/canary on mount", async () => {
    mockedGetCanary.mockResolvedValueOnce({ total: 3, latest: "existing-token" });

    const wrapper = mount(App);
    await flushPromises();

    expect(mockedGetCanary).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("3");
  });

  it("writes a new canary via the button and re-renders the incremented total", async () => {
    mockedGetCanary.mockResolvedValueOnce({ total: 3, latest: "existing-token" });
    mockedCreateCanary.mockResolvedValueOnce({ total: 4, token: "new-token" });

    const wrapper = mount(App);
    await flushPromises();

    await wrapper.find("button").trigger("click");
    await flushPromises();

    expect(mockedCreateCanary).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("4");
    expect(wrapper.text()).toContain("new-token");
  });

  it("renders a visible error state when the fetch fails", async () => {
    mockedGetCanary.mockRejectedValueOnce(new Error("network down"));

    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.find('[role="alert"]').exists()).toBe(true);
  });
});
