// Function to save profile updates (including PFP)
async function updatePFP(avatarUrl) {
  const res = await fetch('/api/profile/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: currentUser,
      avatar: avatarUrl // e.g. "https://i.imgur.com/6VBx3io.png"
    })
  });

  const data = await res.json();
  if (data.success) {
    alert("Profile picture updated!");
  }
}
