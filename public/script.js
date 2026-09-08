const $ = (id) => document.getElementById(id);

let token = localStorage.getItem("shokhruz_token");
let myUsername = localStorage.getItem("shokhruz_username");
let myId = Number(localStorage.getItem("shokhruz_id"));

let mode = "login";
let currentUsername = null;
let refreshTimer = null;
let usernameCheckTimer = null;

async function api(url, options = {}) {
  options.headers = {
    ...(options.headers || {}),
    "Content-Type": "application/json"
  };

  if (token) {
    options.headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }

  return data;
}

function showAuth() {
  $("authScreen").classList.remove("hidden");
  $("chooseScreen").classList.add("hidden");
  $("chatScreen").classList.add("hidden");
}

function showChoose() {
  $("authScreen").classList.add("hidden");
  $("chooseScreen").classList.remove("hidden");
  $("chatScreen").classList.add("hidden");

  $("chatUsername").value = "";
  $("chooseError").textContent = "";
}

function showChat() {
  $("authScreen").classList.add("hidden");
  $("chooseScreen").classList.add("hidden");
  $("chatScreen").classList.remove("hidden");
}

function setMode(newMode) {
  mode = newMode;

  const login = mode === "login";

  $("loginTab").classList.toggle("active", login);
  $("signupTab").classList.toggle("active", !login);

  $("authButton").textContent =
    login ? "Log In" : "Create Account";

  $("authPassword").autocomplete =
    login ? "current-password" : "new-password";

  $("authPassword").placeholder =
    login ? "Password" : "Create a password";

  $("usernameStatus").textContent = "";
  $("usernameStatus").className = "";

  $("authError").textContent = "";
  $("authButton").disabled = false;
}

$("loginTab").addEventListener("click", () => {
  setMode("login");
});

$("signupTab").addEventListener("click", () => {
  setMode("signup");
});

$("authUsername").addEventListener("input", () => {
  if (mode !== "signup") {
    return;
  }

  clearTimeout(usernameCheckTimer);

  const username = $("authUsername").value.trim();

  $("usernameStatus").textContent = "";
  $("authButton").disabled = false;

  if (!username) {
    return;
  }

  usernameCheckTimer = setTimeout(async () => {
    try {
      const result = await api(
        "/api/check-username?username=" +
        encodeURIComponent(username)
      );

      $("usernameStatus").textContent =
        result.message;

      $("usernameStatus").className =
        result.available ? "good" : "bad";

      $("authButton").disabled =
        !result.available;

    } catch {
      $("usernameStatus").textContent =
        "Could not check username.";

      $("usernameStatus").className = "bad";
    }
  }, 250);
});

$("authButton").addEventListener("click", async () => {
  $("authError").textContent = "";

  try {
    const username =
      $("authUsername").value.trim();

    const password =
      $("authPassword").value;

    const endpoint =
      mode === "login"
        ? "/api/login"
        : "/api/register";

    const result = await api(endpoint, {
      method: "POST",
      body: JSON.stringify({
        username,
        password
      })
    });

    token = result.token;
    myUsername = result.username;
    myId = Number(result.userId);

    localStorage.setItem(
      "shokhruz_token",
      token
    );

    localStorage.setItem(
      "shokhruz_username",
      myUsername
    );

    localStorage.setItem(
      "shokhruz_id",
      myId
    );

    showChoose();

  } catch (error) {
    $("authError").textContent =
      error.message;
  }
});

$("doneButton").addEventListener(
  "click",
  openChat
);

$("chatUsername").addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      openChat();
    }
  }
);

async function openChat() {
  const username =
    $("chatUsername").value.trim();

  $("chooseError").textContent = "";

  if (!username) {
    $("chooseError").textContent =
      "Enter a username.";
    return;
  }

  try {
    const user = await api(
      "/api/users/" +
      encodeURIComponent(username)
    );

    currentUsername = user.username;

    $("chatWith").textContent =
      "@" + user.username;

    showChat();

    await loadMessages();

    if (refreshTimer) {
      clearInterval(refreshTimer);
    }

    refreshTimer = setInterval(
      loadMessages,
      1200
    );

    setTimeout(() => {
      $("messageInput").focus();
    }, 100);

  } catch (error) {
    $("chooseError").textContent =
      error.message;
  }
}

async function loadMessages() {
  if (!currentUsername) {
    return;
  }

  try {
    const result = await api(
      "/api/messages/" +
      encodeURIComponent(currentUsername)
    );

    const box = $("messages");

    const wasNearBottom =
      box.scrollTop +
      box.clientHeight >=
      box.scrollHeight - 80;

    box.innerHTML = "";

    if (!result.messages.length) {
      box.innerHTML =
        `<div class="empty">
          No messages yet. Say hello! 👋
        </div>`;

      return;
    }

    for (const message of result.messages) {
      const element =
        document.createElement("div");

      element.className =
        "message" +
        (
          message.senderId === myId
            ? " mine"
            : ""
        );

      element.textContent =
        message.body;

      const time =
        document.createElement("div");

      time.className =
        "messageTime";

      time.textContent =
        formatTime(message.createdAt);

      element.appendChild(time);
      box.appendChild(element);
    }

    if (wasNearBottom) {
      box.scrollTop =
        box.scrollHeight;
    }

  } catch {
    // Keep the chat visible if a refresh temporarily fails.
  }
}

function formatTime(value) {
  const date =
    new Date(value + "Z");

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

$("messageForm").addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const input =
      $("messageInput");

    const body =
      input.value.trim();

    if (!body || !currentUsername) {
      return;
    }

    input.disabled = true;

    try {
      await api("/api/messages", {
        method: "POST",
        body: JSON.stringify({
          username: currentUsername,
          body
        })
      });

      input.value = "";

      await loadMessages();

    } catch (error) {
      alert(error.message);

    } finally {
      input.disabled = false;
      input.focus();
    }
  }
);

$("backButton").addEventListener(
  "click",
  () => {
    currentUsername = null;

    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }

    showChoose();
  }
);

$("chooseLogout").addEventListener(
  "click",
  logout
);

function logout() {
  localStorage.removeItem("shokhruz_token");
  localStorage.removeItem("shokhruz_username");
  localStorage.removeItem("shokhruz_id");

  token = null;
  myUsername = null;
  myId = 0;
  currentUsername = null;

  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  showAuth();
}

if (token && myUsername && myId) {
  showChoose();
} else {
  showAuth();
}
