import { assertEquals, assertFalse, assertStringIncludes } from "@std/assert";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  Modal,
  SearchInput,
  Select,
  Tabs,
  Textarea,
} from "./components/index.ts";
import { renderHtmlResponse } from "./ssr.ts";

// ============================================================================
// 1. Button Component Tests
// ============================================================================

Deno.test("Button - renders primary, secondary, danger, and ghost variants", () => {
  const primaryHtml = renderToString(
    h(Button, { variant: "primary" }, "Primary Action"),
  );
  assertStringIncludes(primaryHtml, "bg-blue-600");
  assertStringIncludes(primaryHtml, "hover:bg-blue-700");
  assertStringIncludes(primaryHtml, "text-white");
  assertStringIncludes(primaryHtml, "Primary Action");

  const secondaryHtml = renderToString(
    h(Button, { variant: "secondary" }, "Secondary Action"),
  );
  assertStringIncludes(secondaryHtml, "bg-gray-800");
  assertStringIncludes(secondaryHtml, "border-gray-600");
  assertStringIncludes(secondaryHtml, "text-gray-200");
  assertStringIncludes(secondaryHtml, "Secondary Action");

  const dangerHtml = renderToString(
    h(Button, { variant: "danger" }, "Delete Record"),
  );
  assertStringIncludes(dangerHtml, "bg-red-600");
  assertStringIncludes(dangerHtml, "hover:bg-red-700");
  assertStringIncludes(dangerHtml, "text-white");
  assertStringIncludes(dangerHtml, "Delete Record");

  const ghostHtml = renderToString(
    h(Button, { variant: "ghost" }, "Cancel"),
  );
  assertStringIncludes(ghostHtml, "bg-transparent");
  assertStringIncludes(ghostHtml, "hover:bg-gray-800");
  assertStringIncludes(ghostHtml, "text-gray-300");
  assertStringIncludes(ghostHtml, "Cancel");
});

Deno.test("Button - renders sm, md, and lg sizes", () => {
  const smHtml = renderToString(h(Button, { size: "sm" }, "Small"));
  assertStringIncludes(smHtml, "px-2.5 py-1 text-xs rounded");

  const mdHtml = renderToString(h(Button, { size: "md" }, "Medium"));
  assertStringIncludes(mdHtml, "px-3.5 py-2 text-sm rounded-md");

  const lgHtml = renderToString(h(Button, { size: "lg" }, "Large"));
  assertStringIncludes(lgHtml, "px-5 py-2.5 text-base rounded-lg");
});

Deno.test("Button - supports type, disabled state, and custom classes", () => {
  const submitHtml = renderToString(
    h(Button, { type: "submit", disabled: true, class: "custom-btn-class" }, "Submit"),
  );
  assertStringIncludes(submitHtml, 'type="submit"');
  assertStringIncludes(submitHtml, "disabled");
  assertStringIncludes(submitHtml, "disabled:opacity-50");
  assertStringIncludes(submitHtml, "custom-btn-class");
});

// ============================================================================
// 2. Badge Component Tests
// ============================================================================

Deno.test("Badge - renders task status colors and formats status labels", () => {
  const statuses = [
    { status: "open", classMatch: "text-sky-400", label: "open" },
    { status: "in_progress", classMatch: "text-amber-400", label: "in progress" },
    { status: "claimed", classMatch: "text-amber-400", label: "claimed" },
    { status: "review", classMatch: "text-purple-400", label: "review" },
    { status: "closed", classMatch: "text-emerald-400", label: "closed" },
    { status: "blocked", classMatch: "text-rose-400", label: "blocked" },
    { status: "neutral", classMatch: "text-slate-300", label: "neutral" },
    { status: "wontfix", classMatch: "text-slate-300", label: "wontfix" },
  ];

  for (const { status, classMatch, label } of statuses) {
    const html = renderToString(h(Badge, { status }));
    assertStringIncludes(html, classMatch);
    assertStringIncludes(html, label);
  }
});

Deno.test("Badge - renders priority pills, size variants, and role tags", () => {
  // Priority pills
  const criticalHtml = renderToString(h(Badge, { priority: "critical" }));
  assertStringIncludes(criticalHtml, "bg-red-950/80");
  assertStringIncludes(criticalHtml, "text-red-300");
  assertStringIncludes(criticalHtml, "critical");

  const highHtml = renderToString(h(Badge, { priority: "high" }));
  assertStringIncludes(highHtml, "bg-orange-950/60");
  assertStringIncludes(highHtml, "text-orange-400");
  assertStringIncludes(highHtml, "high");

  const mediumHtml = renderToString(h(Badge, { priority: "medium" }));
  assertStringIncludes(mediumHtml, "bg-yellow-950/60");
  assertStringIncludes(mediumHtml, "text-yellow-400");
  assertStringIncludes(mediumHtml, "medium");

  const lowHtml = renderToString(h(Badge, { priority: "low" }));
  assertStringIncludes(lowHtml, "bg-slate-800/80");
  assertStringIncludes(lowHtml, "text-slate-400");
  assertStringIncludes(lowHtml, "low");

  // Pill vs non-pill
  const pillHtml = renderToString(h(Badge, { priority: "high", pill: true }));
  assertStringIncludes(pillHtml, "rounded-full");

  const nonPillHtml = renderToString(h(Badge, { priority: "high", pill: false }));
  assertStringIncludes(nonPillHtml, "rounded");
  assertFalse(nonPillHtml.includes("rounded-full"));

  // Sizes sm vs md
  const smHtml = renderToString(h(Badge, { priority: "high", size: "sm" }));
  assertStringIncludes(smHtml, "px-2 py-0.5");

  const mdHtml = renderToString(h(Badge, { priority: "high", size: "md" }));
  assertStringIncludes(mdHtml, "px-2.5 py-1");

  // Role badge with @ prefix
  const roleHtml = renderToString(h(Badge, { role: "architect" }));
  assertStringIncludes(roleHtml, "@architect");
  assertStringIncludes(roleHtml, "text-indigo-300");
  assertStringIncludes(roleHtml, "font-mono");

  // Custom children override
  const customHtml = renderToString(h(Badge, { variant: "critical" }, "URGENT ISSUE"));
  assertStringIncludes(customHtml, "URGENT ISSUE");
});

// ============================================================================
// 3. Input, SearchInput, and Textarea Tests
// ============================================================================

Deno.test("Input - renders labels, helper text, required flags, and error states", () => {
  // Normal state with helperText
  const normalHtml = renderToString(
    h(Input, {
      id: "username-field",
      label: "Username",
      helperText: "Choose a handle between 3-20 characters",
      placeholder: "e.g. jdoe",
      required: true,
      defaultValue: "johndoe",
    }),
  );
  assertStringIncludes(normalHtml, '<label for="username-field"');
  assertStringIncludes(normalHtml, "Username");
  assertStringIncludes(normalHtml, '<span class="text-red-400">*</span>');
  assertStringIncludes(normalHtml, 'id="username-field"');
  assertStringIncludes(normalHtml, 'placeholder="e.g. jdoe"');
  assertStringIncludes(normalHtml, 'value="johndoe"');
  assertStringIncludes(normalHtml, "border-gray-700");
  assertStringIncludes(normalHtml, "Choose a handle between 3-20 characters");

  // Error state
  const errorHtml = renderToString(
    h(Input, {
      id: "email-field",
      label: "Email Address",
      helperText: "We will never share your email",
      error: "Please enter a valid email address",
      type: "email",
    }),
  );
  assertStringIncludes(errorHtml, "Email Address");
  assertStringIncludes(errorHtml, 'type="email"');
  assertStringIncludes(errorHtml, "border-red-500");
  assertStringIncludes(errorHtml, "text-red-100");
  assertStringIncludes(errorHtml, "Please enter a valid email address");
  // When error is present, helperText is suppressed
  assertFalse(errorHtml.includes("We will never share your email"));

  // Disabled state
  const disabledHtml = renderToString(h(Input, { disabled: true }));
  assertStringIncludes(disabledHtml, "disabled");
  assertStringIncludes(disabledHtml, "disabled:opacity-50");
});

Deno.test("SearchInput - renders search input with magnifying glass icon and padding", () => {
  const searchHtml = renderToString(
    h(SearchInput, {
      id: "search-workflows",
      label: "Search Workflows",
      placeholder: "Filter by name or tag...",
      helperText: "Press Enter to search",
    }),
  );
  assertStringIncludes(searchHtml, '<label for="search-workflows"');
  assertStringIncludes(searchHtml, 'id="search-workflows"');
  assertStringIncludes(searchHtml, 'type="search"');
  assertStringIncludes(searchHtml, "pl-9");
  assertStringIncludes(searchHtml, "<svg");
  assertStringIncludes(searchHtml, "Filter by name or tag...");
  assertStringIncludes(searchHtml, "Press Enter to search");

  // With error
  const searchErrorHtml = renderToString(
    h(SearchInput, { error: "Search query too short" }),
  );
  assertStringIncludes(searchErrorHtml, "border-red-500");
  assertStringIncludes(searchErrorHtml, "Search query too short");
});

Deno.test("Textarea - renders with custom rows, helper text, and error states", () => {
  const textareaHtml = renderToString(
    h(Textarea, {
      id: "task-desc",
      label: "Description",
      rows: 6,
      required: true,
      placeholder: "Detailed task context...",
      helperText: "Markdown is supported",
    }),
  );
  assertStringIncludes(textareaHtml, '<label for="task-desc"');
  assertStringIncludes(textareaHtml, "Description");
  assertStringIncludes(textareaHtml, '<span class="text-red-400">*</span>');
  assertStringIncludes(textareaHtml, "<textarea");
  assertStringIncludes(textareaHtml, 'rows="6"');
  assertStringIncludes(textareaHtml, 'placeholder="Detailed task context..."');
  assertStringIncludes(textareaHtml, "Markdown is supported");

  // Textarea with error
  const textareaErrorHtml = renderToString(
    h(Textarea, { error: "Description is required", rows: 4 }),
  );
  assertStringIncludes(textareaErrorHtml, "border-red-500");
  assertStringIncludes(textareaErrorHtml, "Description is required");
});

// ============================================================================
// 4. Select Component Tests
// ============================================================================

Deno.test("Select - renders options array, chevron icon, and selection state", () => {
  const options = [
    { value: "opt1", label: "Option 1" },
    { value: "opt2", label: "Option 2" },
    { value: "opt3", label: "Option 3 (Disabled)", disabled: true },
  ];

  const selectHtml = renderToString(
    h(Select, {
      id: "priority-select",
      label: "Task Priority",
      options,
      value: "opt2",
      helperText: "Select severity level",
      required: true,
    }),
  );

  assertStringIncludes(selectHtml, '<label for="priority-select"');
  assertStringIncludes(selectHtml, "Task Priority");
  assertStringIncludes(selectHtml, "<select");
  assertStringIncludes(selectHtml, '<option value="opt1">Option 1</option>');
  assertStringIncludes(selectHtml, 'value="opt2"');
  assertStringIncludes(selectHtml, "selected");
  assertStringIncludes(selectHtml, 'value="opt3"');
  assertStringIncludes(selectHtml, "disabled");
  assertStringIncludes(selectHtml, "Select severity level");
  assertStringIncludes(selectHtml, "<svg"); // dropdown chevron
});

Deno.test("Select - supports manual option children and error states", () => {
  const selectHtml = renderToString(
    h(
      Select,
      { id: "custom-select", error: "Please select an option" },
      [
        h("option", { value: "a" }, "Alpha"),
        h("option", { value: "b" }, "Beta"),
      ],
    ),
  );

  assertStringIncludes(selectHtml, "border-red-500");
  assertStringIncludes(selectHtml, "Please select an option");
  assertStringIncludes(selectHtml, '<option value="a">Alpha</option>');
  assertStringIncludes(selectHtml, '<option value="b">Beta</option>');
});

// ============================================================================
// 5. Modal Component Tests
// ============================================================================

Deno.test("Modal - renders nothing when isOpen is false", () => {
  const closedHtml = renderToString(
    h(Modal, { isOpen: false, title: "Hidden Dialog" }, "Content"),
  );
  assertEquals(closedHtml, "");
});

Deno.test("Modal - renders backdrop, header, body, footer, and size classes when open", () => {
  const modalHtml = renderToString(
    h(
      Modal,
      {
        isOpen: true,
        id: "confirm-modal",
        title: "Confirm Deployment",
        size: "lg",
        onClose: () => {},
        footer: h(Button, { variant: "primary" }, "Confirm"),
      },
      h("p", {}, "Are you sure you want to deploy to production?"),
    ),
  );

  // Backdrop and ARIA
  assertStringIncludes(modalHtml, 'id="confirm-modal"');
  assertStringIncludes(modalHtml, 'role="dialog"');
  assertStringIncludes(modalHtml, 'aria-modal="true"');
  assertStringIncludes(modalHtml, 'aria-labelledby="confirm-modal-title"');
  assertStringIncludes(modalHtml, "fixed inset-0 bg-black/70 backdrop-blur-sm");

  // Card & Size
  assertStringIncludes(modalHtml, "max-w-lg");

  // Header & Close Button
  assertStringIncludes(modalHtml, 'id="confirm-modal-title"');
  assertStringIncludes(modalHtml, "Confirm Deployment");
  assertStringIncludes(modalHtml, 'aria-label="Close dialog"');

  // Body
  assertStringIncludes(modalHtml, "Are you sure you want to deploy to production?");

  // Footer
  assertStringIncludes(modalHtml, "Confirm");
});

Deno.test("Modal - supports various size variants", () => {
  const sizes = ["sm", "md", "lg", "xl", "2xl"] as const;
  const expectedClasses: Record<typeof sizes[number], string> = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    xl: "max-w-xl",
    "2xl": "max-w-2xl",
  };

  for (const size of sizes) {
    const html = renderToString(h(Modal, { isOpen: true, size }, "Modal Content"));
    assertStringIncludes(html, expectedClasses[size]);
  }
});

// ============================================================================
// 6. Tabs Component Tests
// ============================================================================

Deno.test("Tabs - renders active indicator, count pills, icons, and button controls", () => {
  const tabs = [
    { id: "overview", label: "Overview", count: 3 },
    { id: "tasks", label: "Tasks", count: 12 },
    { id: "logs", label: "Logs", disabled: true },
  ];

  const tabsHtml = renderToString(
    h(Tabs, { tabs, activeTab: "tasks", ariaLabel: "Project Sections" }),
  );

  assertStringIncludes(tabsHtml, 'aria-label="Project Sections"');

  // Active tab (tasks)
  assertStringIncludes(tabsHtml, "border-blue-500 text-blue-400 font-semibold");
  assertStringIncludes(tabsHtml, 'aria-current="true"');
  assertStringIncludes(tabsHtml, "Tasks");
  assertStringIncludes(tabsHtml, "12");

  // Inactive tab (overview)
  assertStringIncludes(tabsHtml, "border-transparent text-gray-400");
  assertStringIncludes(tabsHtml, "Overview");
  assertStringIncludes(tabsHtml, "3");

  // Disabled tab (logs)
  assertStringIncludes(tabsHtml, "cursor-not-allowed opacity-50");
  assertStringIncludes(tabsHtml, "Logs");
});

Deno.test("Tabs - renders anchor links when href is provided", () => {
  const navTabs = [
    { id: "home", label: "Home", href: "/dashboard" },
    { id: "settings", label: "Settings", href: "/settings" },
  ];

  const html = renderToString(
    h(Tabs, { tabs: navTabs, activeTab: "home" }),
  );

  assertStringIncludes(html, '<a href="/dashboard"');
  assertStringIncludes(html, 'href="/settings"');
  assertStringIncludes(html, 'aria-current="page"');
  assertStringIncludes(html, "group inline-flex items-center");
  assertFalse(html.includes('<button type="button"'));
});

// ============================================================================
// 7. EmptyState Component Tests
// ============================================================================

Deno.test("EmptyState - renders default title, custom descriptions, and action slot", () => {
  // Default empty state
  const defaultHtml = renderToString(h(EmptyState, {}));
  assertStringIncludes(defaultHtml, "No items found");
  assertStringIncludes(defaultHtml, "<svg");

  // Customized empty state with description, action button, and custom icon
  const customIcon = h("span", { id: "custom-icon" }, "★");
  const actionBtn = h(Button, { variant: "primary", size: "sm" }, "Create First Workflow");
  const customizedHtml = renderToString(
    h(
      EmptyState,
      {
        title: "No workflows yet",
        description: "Get started by authoring your first autonomous agent workflow.",
        icon: customIcon,
        action: actionBtn,
      },
      h("span", { class: "text-xs text-gray-500" }, "Need help? Check docs."),
    ),
  );

  assertStringIncludes(customizedHtml, "No workflows yet");
  assertStringIncludes(
    customizedHtml,
    "Get started by authoring your first autonomous agent workflow.",
  );
  assertStringIncludes(customizedHtml, 'id="custom-icon"');
  assertStringIncludes(customizedHtml, "Create First Workflow");
  assertStringIncludes(customizedHtml, "Need help? Check docs.");
});

// ============================================================================
// 8. Automatic XSS Escaping Tests
// ============================================================================

Deno.test("XSS Escaping - safely escapes malicious script tags and HTML entities in all components", () => {
  const xssPayload = "<script>alert('xss')</script>";
  const imgPayload = `<img src="x" onerror="alert('xss')"/>`;

  // Button text children escaping
  const buttonHtml = renderToString(h(Button, {}, xssPayload));
  assertFalse(buttonHtml.includes("<script>"));
  assertStringIncludes(buttonHtml, "&lt;script");

  // Badge children and props escaping
  const badgeHtml = renderToString(h(Badge, { status: "custom" }, imgPayload));
  assertFalse(badgeHtml.includes("<img src="));
  assertStringIncludes(badgeHtml, "&lt;img src=");

  // Input label, helperText, and error escaping
  const inputNormalHtml = renderToString(
    h(Input, {
      label: xssPayload,
      helperText: imgPayload,
      defaultValue: `<svg onload=alert(1)>`,
    }),
  );
  assertFalse(inputNormalHtml.includes("<script>"));
  assertFalse(inputNormalHtml.includes("<svg onload"));
  assertStringIncludes(inputNormalHtml, "&lt;script");
  assertStringIncludes(inputNormalHtml, "&lt;img src=");

  const inputErrorHtml = renderToString(
    h(Input, {
      error: "<script>throw Error('bad')</script>",
    }),
  );
  assertFalse(inputErrorHtml.includes("<script>"));
  assertStringIncludes(inputErrorHtml, "&lt;script");

  // SearchInput label and helperText escaping
  const searchHtml = renderToString(
    h(SearchInput, {
      label: xssPayload,
      error: imgPayload,
    }),
  );
  assertFalse(searchHtml.includes("<script>alert"));
  assertFalse(searchHtml.includes("<img src="));
  assertStringIncludes(searchHtml, "&lt;script");
  assertStringIncludes(searchHtml, "&lt;img src=");

  // Textarea label and error escaping
  const textareaHtml = renderToString(
    h(Textarea, {
      label: xssPayload,
      error: imgPayload,
    }),
  );
  assertFalse(textareaHtml.includes("<script>alert"));
  assertFalse(textareaHtml.includes("<img src="));
  assertStringIncludes(textareaHtml, "&lt;script");

  // Select options escaping
  const selectHtml = renderToString(
    h(Select, {
      label: xssPayload,
      options: [{ value: "val", label: "<script>alert('option')</script>" }],
    }),
  );
  assertFalse(selectHtml.includes("<script>alert('option')</script>"));
  assertStringIncludes(selectHtml, "&lt;script");

  // Modal title and content escaping
  const modalHtml = renderToString(
    h(Modal, { isOpen: true, title: xssPayload }, imgPayload),
  );
  assertFalse(modalHtml.includes("<script>alert"));
  assertFalse(modalHtml.includes("<img src="));
  assertStringIncludes(modalHtml, "&lt;script");
  assertStringIncludes(modalHtml, "&lt;img src=");

  // EmptyState title and description escaping
  const emptyHtml = renderToString(
    h(EmptyState, { title: xssPayload, description: imgPayload }),
  );
  assertFalse(emptyHtml.includes("<script>alert"));
  assertFalse(emptyHtml.includes("<img src="));
  assertStringIncludes(emptyHtml, "&lt;script");
  assertStringIncludes(emptyHtml, "&lt;img src=");

  // Tabs label escaping
  const tabsHtml = renderToString(
    h(Tabs, {
      tabs: [{ id: "xss", label: xssPayload }],
      activeTab: "xss",
    }),
  );
  assertFalse(tabsHtml.includes("<script>alert"));
  assertStringIncludes(tabsHtml, "&lt;script");
});

// ============================================================================
// 9. Twind CSS Extraction Tests via renderHtmlResponse
// ============================================================================

Deno.test("Twind CSS Extraction - renderHtmlResponse embeds extracted <style> and Tailwind utility classes", async () => {
  const vnode = h("div", { class: "flex flex-col gap-4 p-6" }, [
    h(Button, { variant: "primary", size: "lg" }, "Launch Task"),
    h(Button, { variant: "danger", size: "sm" }, "Abort"),
    h(Badge, { status: "in_progress" }),
    h(Badge, { priority: "critical" }),
    h(Input, { label: "Cluster Name", placeholder: "prod-us-east" }),
    h(EmptyState, { title: "No Nodes Active" }),
  ]);

  const res = renderHtmlResponse(vnode, {
    title: "Twind Component Integration Test",
  });

  // Verify HTTP status & security headers
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
  assertEquals(res.headers.get("x-content-type-options"), "nosniff");
  assertEquals(res.headers.get("x-frame-options"), "SAMEORIGIN");
  assertEquals(res.headers.get("referrer-policy"), "strict-origin-when-cross-origin");

  const html = await res.text();

  // Verify full document structure
  assertStringIncludes(html, "<!DOCTYPE html>");
  assertStringIncludes(html, '<html lang="en" class="dark">');
  assertStringIncludes(html, "<title>Twind Component Integration Test</title>");

  // Verify Twind style injection
  assertStringIncludes(html, '<style id="__twind">');

  // Verify component markup is rendered
  assertStringIncludes(html, "Launch Task");
  assertStringIncludes(html, "Abort");
  assertStringIncludes(html, "in progress");
  assertStringIncludes(html, "critical");
  assertStringIncludes(html, "Cluster Name");
  assertStringIncludes(html, "No Nodes Active");

  // Verify CSS extraction contains rules for used Tailwind classes
  const styleMatch = html.match(/<style id="__twind">([\s\S]*?)<\/style>/);
  if (!styleMatch) {
    throw new Error('Expected <style id="__twind"> tag to be present in rendered HTML');
  }
  const extractedCss = styleMatch[1];

  // Check that critical utility classes were extracted into CSS
  // (e.g. bg-blue-600, text-white, rounded, flex, etc.)
  assertStringIncludes(extractedCss, "bg-blue-600");
  assertStringIncludes(extractedCss, "bg-red-600");
});
