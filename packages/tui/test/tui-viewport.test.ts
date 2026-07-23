import assert from "node:assert";
import { describe, it } from "node:test";
import type { Component } from "../src/tui.ts";
import { TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

class TestComponent implements Component {
	lines: string[];

	constructor(lines: string[]) {
		this.lines = lines;
	}

	render(_width: number): string[] {
		return this.lines;
	}

	invalidate(): void {}
}

class LoggingVirtualTerminal extends VirtualTerminal {
	writes = "";

	override write(data: string): void {
		this.writes += data;
		super.write(data);
	}
}

describe("TUI alternate-screen viewport", () => {
	it("pins fixed content and maintains internal transcript scrollback", async () => {
		const terminal = new LoggingVirtualTerminal(20, 6);
		const tui = new TUI(terminal);
		const transcript = new TestComponent(Array.from({ length: 8 }, (_, index) => `Line ${index}`));
		const fixed = new TestComponent(["Editor", "Footer"]);
		tui.addChild(transcript);
		tui.addChild(fixed);
		tui.setViewportLayout({ scrollable: transcript, fixed });

		tui.start();
		await terminal.waitForRender();
		assert.deepStrictEqual(terminal.getViewport(), ["Line 4", "Line 5", "Line 6", "Line 7", "Editor", "Footer"]);
		assert.ok(terminal.writes.includes("\x1b[?1049h"), "alternate screen should be enabled");
		assert.ok(terminal.writes.includes("\x1b[?1002h"), "button-motion mouse reporting should be enabled");
		assert.ok(terminal.writes.includes("\x1b[?1006h"), "SGR mouse coordinates should be enabled");

		tui.scrollViewportPage("up");
		await terminal.waitForRender();
		assert.deepStrictEqual(terminal.getViewport(), ["Line 1", "Line 2", "Line 3", "Line 4", "Editor", "Footer"]);

		transcript.lines.push("Line 8");
		tui.requestRender();
		await terminal.waitForRender();
		assert.deepStrictEqual(
			terminal.getViewport(),
			["Line 1", "Line 2", "Line 3", "Line 4", "Editor", "Footer"],
			"appended content should not move a viewport that is scrolled up",
		);

		terminal.sendInput("\x1b[<65;1;1M");
		await terminal.waitForRender();
		assert.deepStrictEqual(terminal.getViewport(), ["Line 4", "Line 5", "Line 6", "Line 7", "Editor", "Footer"]);

		tui.scrollViewportToBottom();
		await terminal.waitForRender();
		assert.deepStrictEqual(terminal.getViewport(), ["Line 5", "Line 6", "Line 7", "Line 8", "Editor", "Footer"]);

		terminal.sendInput("\x1b[<64;1;1M");
		await terminal.waitForRender();
		assert.deepStrictEqual(terminal.getViewport(), ["Line 2", "Line 3", "Line 4", "Line 5", "Editor", "Footer"]);

		tui.scrollViewportToTop();
		await terminal.waitForRender();
		assert.deepStrictEqual(terminal.getViewport(), ["Line 0", "Line 1", "Line 2", "Line 3", "Editor", "Footer"]);

		tui.stop();
		assert.ok(terminal.writes.includes("\x1b[?1002l"), "button-motion mouse reporting should be disabled");
		assert.ok(terminal.writes.includes("\x1b[?1049l"), "alternate screen should be restored");
	});

	it("copies dragged text and opens clicked hyperlinks", async () => {
		const terminal = new LoggingVirtualTerminal(30, 3);
		const tui = new TUI(terminal);
		const link = "\x1b]8;;https://example.com\x07click\x1b]8;;\x07";
		const transcript = new TestComponent(["select me", link]);
		const fixed = new TestComponent(["Footer"]);
		let openedUrl: string | undefined;
		tui.addChild(transcript);
		tui.addChild(fixed);
		tui.setViewportLayout({
			scrollable: transcript,
			fixed,
			onOpenLink: (url) => {
				openedUrl = url;
			},
		});

		tui.start();
		await terminal.waitForRender();

		terminal.sendInput("\x1b[<0;1;1M");
		terminal.sendInput("\x1b[<32;6;1M");
		terminal.sendInput("\x1b[<0;6;1m");
		await terminal.waitForRender();
		assert.ok(terminal.writes.includes("\x1b]52;c;c2VsZWN0\x07"), "selected text should be copied via OSC 52");

		terminal.sendInput("\x1b[<0;1;2M");
		terminal.sendInput("\x1b[<0;1;2m");
		await terminal.waitForRender();
		assert.strictEqual(openedUrl, "https://example.com");

		tui.stop();
	});
});
