      const defaultItems = [
        { item: "1", detail: "Iced coffee oat milk no syrup", unit: 1, price: 65 },
        { item: "2", detail: "Tiramisu", unit: 1, price: 90 },
        { item: "3", detail: "Kitty tips", unit: 1, price: 10 },
      ];

      const state = {
        title: "receipt",
        orderId: "R-8041",
        timestamp: "2026-04-09 21:41",
        table: "07",
        items: defaultItems.map((item) => ({ ...item })),
        qrEnabled: true,
        qrSrc: "../../social-icons/qr-mock.svg",
        customQr: false,
        editMode: false,
        shareId: `rcpt${Math.random().toString(36).slice(2, 8)}`,
      };

      const elements = {
        body: document.body,
        receiptScroll: document.getElementById("receiptScroll"),
        bottomSheet: document.getElementById("bottomSheet"),
        itemsBody: document.getElementById("itemsBody"),
        totalText: document.getElementById("totalText"),
        orderIdText: document.getElementById("orderIdText"),
        timestampText: document.getElementById("timestampText"),
        tableText: document.getElementById("tableText"),
        qrSection: document.getElementById("qrSection"),
        qrImage: document.getElementById("qrImage"),
        orderIdInput: document.getElementById("orderIdInput"),
        timestampInput: document.getElementById("timestampInput"),
        tableInput: document.getElementById("tableInput"),
        receiptTitleInput: document.getElementById("receiptTitleInput"),
        editModeBtn: document.getElementById("editModeBtn"),
        dismissSheetBtn: document.getElementById("dismissSheetBtn"),
        editPanel: document.getElementById("editPanel"),
        sharePanel: document.getElementById("sharePanel"),
        addItemBtn: document.getElementById("addItemBtn"),
        resetItemsBtn: document.getElementById("resetItemsBtn"),
        qrToggle: document.getElementById("qrToggle"),
        uploadQrBtn: document.getElementById("uploadQrBtn"),
        resetQrBtn: document.getElementById("resetQrBtn"),
        qrFileInput: document.getElementById("qrFileInput"),
        shareUrlInput: document.getElementById("shareUrlInput"),
        copyLinkBtn: document.getElementById("copyLinkBtn"),
        downloadBtn: document.getElementById("downloadBtn"),
        shareBtn: document.getElementById("shareBtn"),
        captureTarget: document.getElementById("captureTarget"),
      };

      function formatPrice(value) {
        const price = Number(value) || 0;
        return `${price.toLocaleString("en-US")} THB`;
      }

      function totalAmount() {
        return state.items.reduce((sum, item) => sum + ((Number(item.unit) || 0) * (Number(item.price) || 0)), 0);
      }

      function renderMeta() {
        document.title = state.title || "receipt";
        elements.orderIdText.textContent = state.orderId || "-";
        elements.timestampText.textContent = state.timestamp || "-";
        elements.tableText.textContent = state.table || "-";
        const heading = document.querySelector(".receipt-brand h1");
        if (heading) heading.textContent = state.title || "receipt";
        elements.totalText.textContent = formatPrice(totalAmount());
        elements.shareUrlInput.value = `op4n.me/${state.shareId}`;
      }

      function createCellInput(value, className, onInput) {
        const input = document.createElement("input");
        input.type = "text";
        input.className = className;
        input.value = value;
        input.addEventListener("input", onInput);
        return input;
      }

      function renderItems() {
        elements.itemsBody.innerHTML = "";
        state.items.forEach((item, index) => {
          const row = document.createElement("tr");
          row.className = state.editMode ? "item-row-edit" : "";

          const itemCell = document.createElement("td");
          const detailCell = document.createElement("td");
          const unitCell = document.createElement("td");
          const priceCell = document.createElement("td");

          if (state.editMode) {
            itemCell.appendChild(
              createCellInput(item.item, "", (event) => {
                state.items[index].item = event.target.value;
              })
            );
            detailCell.appendChild(
              createCellInput(item.detail, "", (event) => {
                state.items[index].detail = event.target.value;
              })
            );
            unitCell.appendChild(
              createCellInput(String(item.unit), "qty-input", (event) => {
                state.items[index].unit = event.target.value;
                renderMeta();
              })
            );

            const priceWrap = document.createElement("div");
            priceWrap.className = "item-row-edit";
            priceWrap.appendChild(
              createCellInput(String(item.price), "price-input", (event) => {
                state.items[index].price = event.target.value;
                renderMeta();
              })
            );

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "line-action";
            removeBtn.textContent = "−";
            removeBtn.setAttribute("aria-label", `Remove item ${index + 1}`);
            removeBtn.addEventListener("click", () => {
              state.items.splice(index, 1);
              renderItems();
              renderMeta();
            });
            priceWrap.appendChild(removeBtn);
            priceCell.appendChild(priceWrap);
          } else {
            itemCell.textContent = item.item;
            detailCell.textContent = item.detail;
            unitCell.textContent = item.unit;
            priceCell.textContent = `${(Number(item.unit) || 0) * (Number(item.price) || 0)}`;
          }

          row.append(itemCell, detailCell, unitCell, priceCell);
          elements.itemsBody.appendChild(row);
        });
      }

      function renderQr() {
        elements.qrSection.classList.toggle("hidden", !state.qrEnabled);
        elements.qrImage.src = state.qrSrc;
      }

      function renderEditMode() {
        elements.body.classList.toggle("is-editing", state.editMode);
        elements.editPanel.classList.toggle("hidden", !state.editMode);
        elements.sharePanel.classList.toggle("hidden", !state.editMode);
      }

      function renderAll() {
        renderMeta();
        renderItems();
        renderQr();
        renderEditMode();
      }

      function showSheet() {
        if (state.editMode) return;
        elements.body.classList.add("sheet-available");
        elements.body.classList.add("show-sheet");
      }

      function hideSheet() {
        elements.body.classList.remove("show-sheet");
      }

      function setSheetAvailable(value) {
        elements.body.classList.toggle("sheet-available", value);
        if (!value) {
          hideSheet();
        }
      }

      function enterEditMode() {
        state.editMode = true;
        hideSheet();
        renderAll();
      }

      function resetItems() {
        state.items = defaultItems.map((item) => ({ ...item }));
        renderAll();
      }

      function readFileAsDataUrl(file, onLoad) {
        const reader = new FileReader();
        reader.onload = () => onLoad(reader.result);
        reader.readAsDataURL(file);
      }

      async function copyLink() {
        const value = elements.shareUrlInput.value;
        try {
          await navigator.clipboard.writeText(value);
          elements.copyLinkBtn.textContent = "Copied";
        } catch {
          elements.copyLinkBtn.textContent = "Copy failed";
        }
        setTimeout(() => {
          elements.copyLinkBtn.textContent = "Copy link";
        }, 1400);
      }

      async function downloadReceipt() {
        const canvas = await html2canvas(elements.captureTarget, {
          backgroundColor: "#fffefa",
          scale: 2,
        });
        const link = document.createElement("a");
        link.download = `${state.shareId}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      }

      async function shareReceipt() {
        const shareUrl = `https://${elements.shareUrlInput.value}`;
        if (navigator.share) {
          try {
            await navigator.share({
              title: state.title || "receipt",
              text: "Take a look at my receipt.",
              url: shareUrl,
            });
            return;
          } catch {
            // Fall through to copy.
          }
        }
        try {
          await navigator.clipboard.writeText(shareUrl);
          elements.shareBtn.textContent = "Link copied";
        } catch {
          elements.shareBtn.textContent = "Share unavailable";
        }
        setTimeout(() => {
          elements.shareBtn.textContent = "Share receipt";
        }, 1400);
      }

      elements.orderIdInput.addEventListener("input", (event) => {
        state.orderId = event.target.value;
        renderMeta();
      });

      elements.timestampInput.addEventListener("input", (event) => {
        state.timestamp = event.target.value;
        renderMeta();
      });

      elements.tableInput.addEventListener("input", (event) => {
        state.table = event.target.value;
        renderMeta();
      });

      elements.receiptTitleInput.addEventListener("input", (event) => {
        state.title = event.target.value;
        renderMeta();
      });

      elements.editModeBtn.addEventListener("click", enterEditMode);
      elements.dismissSheetBtn.addEventListener("click", () => {
        hideSheet();
      });
      elements.addItemBtn.addEventListener("click", () => {
        state.editMode = true;
        state.items.push({
          item: String(state.items.length + 1),
          detail: "New delightful line",
          unit: 1,
          price: 0,
        });
        renderAll();
      });

      elements.resetItemsBtn.addEventListener("click", resetItems);

      elements.qrToggle.addEventListener("change", (event) => {
        state.qrEnabled = event.target.checked;
        renderQr();
      });

      elements.uploadQrBtn.addEventListener("click", () => {
        elements.qrFileInput.click();
      });

      elements.qrFileInput.addEventListener("change", () => {
        const file = elements.qrFileInput.files?.[0];
        if (!file) return;
        readFileAsDataUrl(file, (dataUrl) => {
          state.qrSrc = dataUrl;
          state.customQr = true;
          renderQr();
        });
      });

      elements.resetQrBtn.addEventListener("click", () => {
        state.qrSrc = "../../social-icons/qr-mock.svg";
        state.customQr = false;
        elements.qrFileInput.value = "";
        renderQr();
      });

      elements.copyLinkBtn.addEventListener("click", copyLink);
      elements.downloadBtn.addEventListener("click", downloadReceipt);
      elements.shareBtn.addEventListener("click", shareReceipt);

      elements.receiptScroll.addEventListener("scroll", () => {
        const threshold = 18;
        const atBottom =
          elements.receiptScroll.scrollTop + elements.receiptScroll.clientHeight >=
          elements.receiptScroll.scrollHeight - threshold;
        if (atBottom) {
          showSheet();
        } else {
          setSheetAvailable(false);
        }
      });

      renderAll();
      requestAnimationFrame(() => {
        setTimeout(() => {
          elements.body.classList.add("is-printed");
        }, 260);
      });