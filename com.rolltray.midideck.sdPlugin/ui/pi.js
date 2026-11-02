/* Shared property-inspector plumbing: no dependency, no CDN, works offline. */
(function () {
	let socket = null;
	let context = null;

	function send(event, payload) {
		if (!socket || socket.readyState !== WebSocket.OPEN) return;
		const message = payload === undefined ? { event, context } : { event, context, payload };
		socket.send(JSON.stringify(message));
	}

	window.pi = {
		/** Registers the Stream Deck callback and forwards settings to `paint`. */
		connect(paint) {
			window.connectElgatoStreamDeckSocket = function (port, propertyInspectorUuid, registerEvent) {
				context = propertyInspectorUuid;
				socket = new WebSocket(`ws://127.0.0.1:${port}`);

				socket.onopen = function () {
					socket.send(JSON.stringify({ event: registerEvent, uuid: context }));
					send("getSettings");
				};

				socket.onmessage = function (message) {
					let data;
					try {
						data = JSON.parse(message.data);
					} catch {
						return;
					}
					if (data.event === "didReceiveSettings") paint(data.payload.settings || {});
				};
			};
		},

		/** Persists the full settings object for the current action. */
		save(settings) {
			send("setSettings", settings);
		},
	};
})();
