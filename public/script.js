// --- CONFIGURATION ---
const MEMBER_COLORS = { 'Papa': '#d1e7ff', 'Maman': '#f8d7da', 'Gardienne': '#d4edda', 'Enfants': '#fff3cd' };
const CATEGORY_COLORS = { 'Rendez-vous': '#f5c6cb', 'École': '#ffeeba', 'Activité': '#b8daff', 'Tâche': '#a3cfbb', 'Repas': '#e2e3e5' };
const DAY_ORDER = { 'Lundi': 1, 'Mardi': 2, 'Mercredi': 3, 'Jeudi': 4, 'Vendredi': 5, 'Samedi': 6, 'Dimanche': 7 };
const RECURRING_ITEMS = ["Lait", "Jus d'orange", "Jambon", "Pain", "Fromage en tranches", "Œufs", "Yogourt", "Fruits variés (collations)"];

// --- INITIALISATION FIREBASE ---
// Firebase is now initialized by the /__/firebase/init.js script included in index.html
var auth = firebase.auth();
var db = firebase.firestore();

// --- SÉLECTEURS DOM ---
function $(selector) {
    return document.querySelector(selector);
}
let currentDate = new Date();
let allRecipes = [];
let activeView = 'dashboard';
let cycleStartDate = new Date('2024-01-01'); // Default value
let sortState = {};

// --- AUTHENTIFICATION ---
auth.onAuthStateChanged(user => {
    $("#auth-container").style.display = user ? 'none' : 'flex';
    $("#app-container").style.display = user ? 'flex' : 'none';
    if (user) {
        $("#user-email-display").textContent = user.email;
        initApp();
    }
});
$("#login-btn").addEventListener('click', () => {
    const email = $("#email").value, password = $("#password").value;
    auth.signInWithEmailAndPassword(email, password).catch(err => {
        if (err.code === 'auth/user-not-found') auth.createUserWithEmailAndPassword(email, password);
        else alert(err.message);
    });
});
$("#logout-btn").addEventListener('click', () => auth.signOut());

// --- LOGIQUE DE L'APPLICATION ---
async function initApp() {
    // --- App Version Indicator ---
    const now = new Date();
    const formattedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    $('#app-version').textContent = `Version: ${formattedDate}`;

    const familyId = "defaultFamily";
    const refs = {
        recipes: db.collection(`families/${familyId}/recipes`),
        meals: db.collection(`families/${familyId}/meals`),
        events: db.collection(`families/${familyId}/calendarEvents`),
        tasks: db.collection(`families/${familyId}/tasks`),
        groceries: db.collection(`families/${familyId}/groceries`),
        settings: db.collection(`families/${familyId}/settings`),
        users: db.collection(`families/${familyId}/users`),
        csv: db.collection(`families/${familyId}/csv`)
    };

    // --- GESTION DES MODALES (MODULARISÉE) ---
    function openModal(modalId) {
        const modal = $(`#${modalId}`);
        if (modal) modal.style.display = 'flex';
    }

    function closeModal(modalId) {
        const modal = $(`#${modalId}`);
        if (modal) modal.style.display = 'none';
    }

    function closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.style.display = 'none';
        });
    }

    // --- GESTION DES BOUTONS DE FERMETURE (X) ---
    document.querySelectorAll('.close-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation(); // Empêche d'autres clics de se déclencher
            btn.closest('.modal').style.display = 'none';
        };
    });

    // --- IMPORTATION CSV ---
    $("#import-csv-btn").addEventListener('click', () => $("#csv-file-input").click());
    $("#csv-file-input").addEventListener('change', (e) => {
        const reader = new FileReader();
        reader.onload = (event) => processCSV(event.target.result);
        reader.readAsText(e.target.files[0], 'UTF-8');
    });

    function parseCSV(text) {
        const lines = text.split('\n');
        const headers = lines.shift().split(',').map(h => h.trim().replace(/"/g, ''));
        return lines.map(line => {
            if (!line.trim()) return null;
            const values = [];
            let current = '';
            let inQuotes = false;
            for (const char of line) {
                if (char === '"' && !inQuotes) { inQuotes = true; continue; }
                if (char === '"' && inQuotes) { inQuotes = false; continue; }
                if (char === ',' && !inQuotes) { values.push(current); current = ''; }
                else { current += char; }
            }
            values.push(current);
            const obj = {};
            headers.forEach((h, i) => obj[h] = values[i] || '');
            return obj;
        }).filter(Boolean);
    }

    async function processCSV(csv) {
        const recipesData = parseCSV(csv);
        const batch = db.batch();
        const snap = await refs.recipes.get();
        snap.docs.forEach(doc => batch.delete(doc.ref));

        recipesData.forEach(recipe => {
            if (recipe.Plat) {
                if (recipe.Ingrédients && !recipe.Ingrédients.trim().startsWith('[')) {
                    const ingredientsArray = recipe.Ingrédients.split('\n')
                        .map(line => line.trim())
                        .filter(line => line)
                        .map(line => ({ qte: '', unite: '', nom: line }));
                    recipe.Ingrédients = JSON.stringify(ingredientsArray);
                }

                batch.set(refs.recipes.doc(), recipe);
            }
        });

        const today = new Date();
        const dayOfWeek = today.getDay();
        const daysUntilMonday = (dayOfWeek === 0) ? 1 : (8 - dayOfWeek);
        const nextMonday = new Date(today);
        nextMonday.setDate(today.getDate() + daysUntilMonday);
        nextMonday.setHours(0, 0, 0, 0);

        await refs.settings.doc('mealCycle').set({ startDate: nextMonday });
        cycleStartDate = nextMonday;

        await batch.commit();
        alert(`Recettes importées avec succès!`);

        await fetchAndSortRecipes();
        renderMainContent();
    }

    // --- NAVIGATION ---
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            activeView = e.target.dataset.view;
            renderMainContent();
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            e.target.classList.add('active');
        });
    });

    const settingsDoc = await refs.settings.doc('mealCycle').get();
    if (settingsDoc.exists) {
        cycleStartDate = settingsDoc.data().startDate.toDate();
    }

    async function fetchAndSortRecipes() {
        const recipesSnap = await refs.recipes.get();
        allRecipes = recipesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        allRecipes.sort((a, b) => (a.Semaine - b.Semaine) || ((DAY_ORDER[a.Jour] || 99) - (DAY_ORDER[b.Jour] || 99)) || a.Repas.localeCompare(b.Repas));
    }

    await fetchAndSortRecipes();

    function renderMainContent() {
        const mainContent = $('.main-content');
        if (activeView === 'dashboard') {
            mainContent.innerHTML = `<div class="view-container">
                <h2>Tableau de bord - Aujourd'hui</h2>
                <div class="dashboard-grid">
                    <div class="dashboard-card" id="dashboard-meals"><h3>Repas</h3></div>
                    <div class="dashboard-card" id="dashboard-tasks"><h3>Tâches</h3></div>
                    <div class="dashboard-card" id="dashboard-events"><h3>Événements</h3></div>
                    <div class="dashboard-card" id="dashboard-groceries"></div>
                </div>
            </div>`;
            setTimeout(renderDashboard, 0);
        }
        else if (activeView === 'calendar') {
            mainContent.innerHTML = `
                <div class="calendar-container">
                    <div class="calendar-header">
                        <button id="prev-month-btn">&lt; Précédent</button>
                        <h2 id="month-year-header"></h2>
                        <button id="next-month-btn">Suivant &gt;</button>
                    </div>
                    <div class="calendar-grid" id="day-headers"></div>
                    <div class="calendar-grid" id="calendar-body"></div>
                </div>`;
            renderCalendar(currentDate);
        } else if (activeView === 'tasks') {
            mainContent.innerHTML = `<div class="view-container">
                <h2>Tâches</h2>
                <form id="add-task-form" class="form-group">
                    <input type="text" id="task-title" placeholder="Nouvelle tâche..." required>
                    <textarea id="task-description" placeholder="Description..."></textarea>
                    <input type="date" id="task-due-date">
                    <select id="task-assignee"></select>
                    <select id="task-priority">
                        <option value="low">Basse</option>
                        <option value="medium" selected>Moyenne</option>
                        <option value="high">Haute</option>
                    </select>
                    <button type="submit">Ajouter Tâche</button>
                </form>
                <div id="task-list"></div>
            </div>`;
            renderTasks();
        } else if (activeView === 'groceries') {
            mainContent.innerHTML = `<div class="view-container">
                <h2>Épicerie</h2>
                <div class="grocery-actions">
                    <button id="generate-grocery-list-btn">Générer la liste pour la semaine</button>
                </div>
                <form id="add-grocery-form" class="form-group">
                    <input type="text" id="grocery-item-name" placeholder="Ajouter un article..." required>
                    <button type="submit">Ajouter</button>
                </form>
                <div id="grocery-list"></div>
            </div>`;
            renderGroceries();
        } else if (activeView === 'recipes') {
             mainContent.innerHTML = `<div class="view-container"><h2>Livre de recettes</h2><input type="text" id="recipe-search" placeholder="Rechercher une recette..."><div id="recipe-book-table-container"><table id="recipe-book-table"></table></div></div>`;
             renderRecipeBook();
        } else if (activeView === 'settings') {
            mainContent.innerHTML = `
                <div class="view-container">
                    <h2>Paramètres</h2>
                    <div class="settings-section">
                        <h3>Gérer les utilisateurs</h3>
                        <form id="add-user-form" class="form-group">
                            <input type="text" id="user-name" placeholder="Nom de l'utilisateur" required>
                            <input type="color" id="user-color" value="#e2e3e5">
                            <button type="submit">Ajouter un utilisateur</button>
                        </form>
                        <div id="user-list"></div>
                    </div>
                </div>`;
            renderSettings();
        }
    }

    async function renderDashboard() {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];

        const mealDoc = await refs.meals.doc(dateStr).get();
        const mealData = mealDoc.data() || {};
        const dashboardMeals = $('#dashboard-meals');
        dashboardMeals.innerHTML = '<h3>Repas</h3>';
        ['Déjeuner', 'Souper'].forEach(repas => {
            const meal = mealData[repas.toLowerCase()];
            dashboardMeals.innerHTML += `<p><strong>${repas}:</strong> ${meal && meal.plat ? meal.plat : 'Non planifié'}</p>`;
        });

        const tasksSnap = await refs.tasks.where('dueDate', '==', dateStr).where('completed', '==', false).get();
        const dashboardTasks = $('#dashboard-tasks');
        dashboardTasks.innerHTML = '<h3>Tâches du jour</h3>';
        if (tasksSnap.empty) dashboardTasks.innerHTML += '<p>Aucune tâche pour aujourd\'hui.</p>';
        else tasksSnap.forEach(doc => dashboardTasks.innerHTML += `<p>${doc.data().title}</p>`);

        const dashboardGroceries = $('#dashboard-groceries');
        if (dashboardGroceries) {
            dashboardGroceries.innerHTML = `
                <h3>Épicerie - Ajout rapide</h3>
                <form id="dashboard-add-grocery-form" class="form-group">
                    <input type="text" id="dashboard-grocery-item-name" placeholder="Ajouter un article..." required>
                    <button type="submit">Ajouter</button>
                </form>
                <div id="dashboard-grocery-feedback" class="feedback-message"></div>
            `;
        }
    }

    function renderCalendar(date) {
        const year = date.getFullYear(), month = date.getMonth();
        $("#month-year-header").textContent = date.toLocaleString('fr-CA', { month: 'long', year: 'numeric' });

        const calendarBody = $("#calendar-body");
        const dayHeaders = $("#day-headers");
        dayHeaders.innerHTML = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'].map(d => `<div class="calendar-day-header">${d}</div>`).join('');

        const firstDayOfMonth = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        calendarBody.innerHTML = Array(firstDayOfMonth).fill(`<div class="calendar-day other-month"></div>`).join('');

        for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            calendarBody.innerHTML += `
                <div class="calendar-day" data-date="${dateStr}">
                    <div class="day-number">${day}</div>
                    <div class="day-content">
                        <div class="day-meals">
                            <div class="meal-slot" data-meal-type="Déjeuner" id="déjeuner-${dateStr}"></div>
                            <div class="meal-slot" data-meal-type="Souper" id="souper-${dateStr}"></div>
                        </div>
                        <div class="day-events"></div>
                    </div>
                </div>`;
        }

        const prevBtn = $("#prev-month-btn");
        const nextBtn = $("#next-month-btn");
        if (prevBtn && nextBtn) {
            prevBtn.onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(currentDate); };
            nextBtn.onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(currentDate); };
        }

        listenForCalendarData(year, month);
    }

    function listenForCalendarData(year, month) {
        refs.meals.onSnapshot(snap => {
            const manualMeals = {};
            snap.forEach(doc => manualMeals[doc.id] = doc.data());

            document.querySelectorAll(".calendar-day[data-date]").forEach(dayCell => {
                const dateStr = dayCell.dataset.date;
                const current = new Date(dateStr + 'T12:00:00');
                const manual = manualMeals[dateStr];

                const diffDays = Math.floor((current - cycleStartDate) / (1000 * 3600 * 24));
                const week = (Math.floor(diffDays / 7) % 3) + 1;
                const dayName = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][current.getDay()];

                ['Déjeuner', 'Souper'].forEach(repas => {
                    const mealTypeLower = repas.toLowerCase();
                    const manualMeal = manual ? manual[repas.toLowerCase()] : undefined;
                    const autoMeal = allRecipes.find(r => r.Semaine == week && r.Jour === dayName && r.Repas === repas);

                    const mealToDisplay = manualMeal !== undefined ? manualMeal : (autoMeal ? { recipeId: autoMeal.id, plat: autoMeal.Plat, Image: autoMeal.Image } : null);
                    updateMealSlot(`${mealTypeLower}-${dateStr}`, mealToDisplay);
                });
            });
        });

        refs.events.onSnapshot(snap => {
            document.querySelectorAll('.event-item').forEach(el => el.remove());

            const monthStart = new Date(year, month, 1);
            const monthEnd = new Date(year, month + 1, 0);

            snap.forEach(doc => {
                const event = { id: doc.id, ...doc.data() };
                const eventStartDate = new Date(event.date + 'T12:00:00');

                for (let d = new Date(eventStartDate); d <= monthEnd; ) {
                    if (d >= monthStart) {
                        const dateStr = d.toISOString().split('T')[0];
                        const dayCell = document.querySelector(`.calendar-day[data-date="${dateStr}"]`);
                        if (dayCell) {
                            const eventsContainer = dayCell.querySelector('.day-events');
                            const eventEl = document.createElement('div');
                            eventEl.className = 'event-item';
                            eventEl.textContent = event.title;
                            eventEl.dataset.eventId = event.id;
                            eventEl.style.backgroundColor = CATEGORY_COLORS[event.category] || '#e2e3e5';
                            eventEl.style.color = '#333';
                            eventsContainer.appendChild(eventEl);
                        }
                    }

                    if (event.recurrence === 'weekly') {
                        d.setDate(d.getDate() + 7);
                    } else if (event.recurrence === 'biweekly') {
                        d.setDate(d.getDate() + 14);
                    } else if (event.recurrence === 'monthly') {
                        d.setMonth(d.getMonth() + 1);
                    } else {
                        break;
                    }
                }
            });
        });
    }

    let activeDate, activeMealType;

    $('#change-meal-btn').addEventListener('click', () => {
        closeModal('recipe-details-modal');
        showRecipeSelection();
    });

    function showRecipeDetails(recipeId) {
        const recipe = allRecipes.find(r => r.id === recipeId);
        if (!recipe) return;

        let ingredientsHTML = '<ul><li>Aucun ingrédient listé.</li></ul>';
        if (recipe.Ingrédients) {
            try {
                let ingredients = JSON.parse(recipe.Ingrédients);
                if (Array.isArray(ingredients)) {
                    ingredientsHTML = '<ul>' + ingredients.map(ing => `<li>${[ing.qte, ing.unite, ing.nom].filter(Boolean).join(' ')}</li>`).join('') + '</ul>';
                }
            } catch (e) {
                ingredientsHTML = `<ul>${recipe.Ingrédients.split('\n').map(i => `<li>${i}</li>`).join('')}</ul>`;
            }
        }

        let imageHTML = '';
        if (recipe.Image && recipe.Image.trim() !== '') {
            imageHTML = `<div class="recipe-image-container"><img src="${recipe.Image}" alt="${recipe.Plat}" class="recipe-image"></div>`;
        }

        $("#recipe-details-content").innerHTML = `
            ${imageHTML}
            <h3>${recipe.Plat}</h3>
            <h4>Ingrédients :</h4>
            ${ingredientsHTML}
            <h4>Recette :</h4>
            <pre>${recipe.Recette || ''}</pre>
        `;

        const chefContainer = $("#chef-assignment-container");
        chefContainer.innerHTML = `<label for="chef-select">Chef assigné :</label>
                                 <select id="chef-select"><option value="">-- Choisir --</option></select>`;

        refs.users.get().then(snap => {
            const chefSelect = $("#chef-select");
            if (!chefSelect) return;
            snap.forEach(doc => {
                const user = doc.data();
                chefSelect.innerHTML += `<option value="${user.name}">${user.name}</option>`;
            });

            refs.meals.doc(activeDate).get().then(doc => {
                if (doc.exists && doc.data()[activeMealType.toLowerCase()]) {
                    $("#chef-select").value = doc.data()[activeMealType.toLowerCase()].chef || "";
                }
            });
        });

        $("#chef-select").onchange = (e) => {
            const chef = e.target.value;
            const mealKey = activeMealType.toLowerCase();
            const mealUpdate = {};

            refs.meals.doc(activeDate).get().then(doc => {
                const existingData = (doc.exists && doc.data()[mealKey]) ? doc.data()[mealKey] : {};
                mealUpdate[mealKey] = { ...existingData, chef: chef };
                refs.meals.doc(activeDate).set(mealUpdate, { merge: true });
            });
        };

        openModal('recipe-details-modal');
    }

    function showRecipeSelection() {
        const filteredRecipes = allRecipes
            .filter(r => r.Repas === activeMealType)
            .sort((a,b) => a.Plat.localeCompare(b.Plat));

        const listElement = $("#recipe-select-list");
        if (listElement) {
            listElement.innerHTML = filteredRecipes.map(r =>
                `<div class="recipe-select-item" data-id="${r.id}" data-plat="${r.Plat}">${r.Plat}</div>`
            ).join('');
        }

        const searchInput = $("#recipe-select-search");
        if (searchInput) {
            searchInput.value = '';
            searchInput.oninput = (e) => {
                const query = e.target.value.toLowerCase();
                document.querySelectorAll('.recipe-select-item').forEach(item => {
                    item.style.display = item.textContent.toLowerCase().includes(query) ? 'block' : 'none';
                });
            };
        }

        openModal('recipe-select-modal');
    }

    $('#recipe-select-modal').addEventListener('click', async (e) => {
        const target = e.target;
        const modal = $('#recipe-select-modal');
        const { date, mealType } = modal.dataset;

        if (!date || !mealType) return;

        const mealKey = mealType.toLowerCase();

        const recipeItem = target.closest('.recipe-select-item');
        if (recipeItem) {
            const { id, plat } = recipeItem.dataset;
            const update = {};
            const mealSlot = $(`#${mealKey}-${date}`);
            const existingData = mealSlot ? JSON.parse(mealSlot.dataset.mealData || '{}') : {};
            update[mealKey] = { ...existingData, recipeId: id, plat: plat };

            await refs.meals.doc(date).set(update, { merge: true });
            closeModal('recipe-select-modal');
        }
        else if (target.id === 'remove-meal-btn') {
            const update = { [mealKey]: null };
            await refs.meals.doc(date).set(update, { merge: true });
            closeModal('recipe-select-modal');
        }
        else if (target.id === 'add-new-recipe-btn') {
            closeModal('recipe-select-modal');
            showEditRecipeModal(null, () => {
                showRecipeSelection();
            });
        }
    });

    async function showEventModal(date, eventId = null) {
        const form = $('#event-form');
        form.reset();
        $('#event-id').value = eventId || '';
        $('#event-date').value = date || '';
        $('#delete-event-btn').style.display = eventId ? 'inline-block' : 'none';
        $('#event-modal-title').textContent = eventId ? 'Modifier l\'événement' : 'Ajouter un événement';

        $('#event-category').innerHTML = Object.keys(CATEGORY_COLORS).map(cat => `<option>${cat}</option>`).join('');

        const assigneesContainer = $('#event-assignees');
        assigneesContainer.innerHTML = '';
        refs.users.get().then(snap => {
            snap.forEach(doc => {
                const user = doc.data();
                assigneesContainer.innerHTML += `<div><input type="checkbox" id="assignee-${doc.id}" value="${user.name}"><label for="assignee-${doc.id}">${user.name}</label></div>`;
            });
        });

        if (eventId) {
            const doc = await refs.events.doc(eventId).get();
            if (doc.exists) {
                const event = doc.data();
                $('#event-title').value = event.title;
                $('#event-category').value = event.category;
                $('#event-date').value = event.date;
                $('#event-recurrence').value = event.recurrence || 'none';
                if (event.assignees) {
                    event.assignees.forEach(assignee => {
                        const checkbox = $(`#assignee-${assignee}`);
                        if (checkbox) checkbox.checked = true;
                    });
                }
            }
        }

        openModal('event-modal');
    }

    $('#app-container').addEventListener('click', async (e) => {
        const target = e.target;

        if (target.id === 'delete-event-btn') {
            const eventId = $('#event-id').value;
            if (eventId && confirm("Êtes-vous sûr de vouloir supprimer cet événement ?")) {
                await refs.events.doc(eventId).delete();
                closeModal('event-modal');
            }
        } else if (target.id === 'generate-grocery-list-btn') {
            generateWeeklyGroceryList();
        }
        else if (target.closest('.meal-slot')) {
            const mealSlot = target.closest('.meal-slot');
            activeDate = mealSlot.id.substring(mealSlot.id.indexOf('-') + 1);
            activeMealType = mealSlot.dataset.mealType;

            const mealData = JSON.parse(mealSlot.dataset.mealData || '{}');
            if (mealData.recipeId) {
                showRecipeDetails(mealData.recipeId);
            } else {
                const recipeSelectModal = $('#recipe-select-modal');
                recipeSelectModal.dataset.date = activeDate;
                recipeSelectModal.dataset.mealType = activeMealType;
                showRecipeSelection();
            }

        } else if (target.closest('.event-item')) {
            showEventModal(null, target.closest('.event-item').dataset.eventId);
        } else if (target.closest('.calendar-day[data-date]')) {
            if (!target.closest('.day-content')) {
                showEventModal(target.closest('.calendar-day').dataset.date);
            }
        }
    });

    $('#app-container').addEventListener('submit', async (e) => {
        e.preventDefault();
        const formId = e.target.id;

        if (formId === 'event-form') {
            const eventId = $('#event-id').value;
            const assignees = [...document.querySelectorAll('#event-assignees input:checked')].map(el => el.value);
            const eventData = {
                title: $('#event-title').value,
                date: $('#event-date').value,
                category: $('#event-category').value,
                recurrence: $('#event-recurrence').value,
                assignees: assignees
            };
            if (eventId) await refs.events.doc(eventId).update(eventData);
            else await refs.events.add(eventData);
            closeModal('event-modal');
        } else if (formId === 'add-user-form') {
            const userName = $('#user-name').value.trim();
            const userColor = $('#user-color').value;
            if (userName) {
                refs.users.add({ name: userName, color: userColor });
                e.target.reset();
            }
        } else if (formId === 'dashboard-add-grocery-form') {
            const input = $('#dashboard-grocery-item-name');
            const itemName = input.value.trim();
            if (itemName) {
                await refs.groceries.add({ name: itemName, completed: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
                const feedback = $('#dashboard-grocery-feedback');
                feedback.textContent = `"${itemName}" a été ajouté.`;
                input.value = '';
                setTimeout(() => feedback.textContent = '', 3000);
            }
        }
    });

    function updateMealSlot(elementId, mealData) {
        const slot = $(`#${elementId}`);
        if (!slot) return;

        slot.dataset.mealData = JSON.stringify(mealData || {});

        slot.style.backgroundColor = 'transparent';

        if (mealData && mealData.plat) {
            if (mealData.chef && MEMBER_COLORS[mealData.chef]) {
                slot.style.backgroundColor = MEMBER_COLORS[mealData.chef];
            }
            slot.innerHTML = `<span class="meal-name" data-recipe-id="${mealData.recipeId}">${mealData.plat}</span>`;
        } else if (mealData === null) {
            slot.innerHTML = '<i>(Retiré)</i>';
        } else {
            slot.innerHTML = '<i>(Non planifié)</i>';
        }
    }

    function renderTasks() {
        const assigneeSelect = $('#task-assignee');
        if (assigneeSelect) {
            refs.users.get().then(snap => {
                assigneeSelect.innerHTML = '<option value="">Non assigné</option>';
                snap.forEach(doc => {
                    const user = doc.data();
                    assigneeSelect.innerHTML += `<option value="${user.name}">${user.name}</option>`;
                });
            });
        }

        const addTaskForm = $('#add-task-form');
        if (addTaskForm) {
            addTaskForm.onsubmit = (e) => {
                e.preventDefault();
                refs.tasks.add({
                    title: $('#task-title').value,
                    description: $('#task-description').value,
                    dueDate: $('#task-due-date').value,
                    assignee: $('#task-assignee').value,
                    priority: $('#task-priority').value,
                    status: 'not-started',
                    subtasks: [],
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                addTaskForm.reset();
            };
        }

        const taskList = $('#task-list');
        if (!taskList) return;

        taskList.addEventListener('change', e => {
            const target = e.target;
            if (target.classList.contains('task-status-select')) {
                const taskId = target.dataset.id;
                const newStatus = target.value;
                refs.tasks.doc(taskId).update({ status: newStatus });
            }
            if (target.classList.contains('subtask-checkbox')) {
                const taskId = target.dataset.taskId;
                const subtaskIndex = parseInt(target.dataset.index, 10);

                refs.tasks.doc(taskId).get().then(doc => {
                    if (doc.exists) {
                        const task = doc.data();
                        const subtasks = task.subtasks || [];
                        subtasks[subtaskIndex].completed = target.checked;
                        refs.tasks.doc(taskId).update({ subtasks });
                    }
                });
            }
        });

        taskList.addEventListener('submit', e => {
            e.preventDefault();
            const target = e.target;
            if (target.classList.contains('add-subtask-form')) {
                const taskId = target.dataset.id;
                const input = target.querySelector('.subtask-input');
                const subtaskTitle = input.value.trim();
                if (subtaskTitle) {
                    const newSubtask = { title: subtaskTitle, completed: false };
                    refs.tasks.doc(taskId).update({
                        subtasks: firebase.firestore.FieldValue.arrayUnion(newSubtask)
                    });
                    input.value = '';
                }
            }
        });

        refs.tasks.orderBy('createdAt', 'desc').onSnapshot(snap => {
            taskList.innerHTML = '';
            if (snap.empty) {
                taskList.innerHTML = '<p>Aucune tâche pour le moment.</p>';
                return;
            }
            snap.forEach(doc => {
                const task = {id: doc.id, ...doc.data()};
                const item = document.createElement('div');
                item.className = `task-item priority-${task.priority || 'medium'} status-${task.status || 'not-started'}`;

                const subtasksHTML = (task.subtasks || []).map((sub, index) => `
                    <div class="subtask-item">
                        <input type="checkbox" class="subtask-checkbox" data-task-id="${task.id}" data-index="${index}" ${sub.completed ? 'checked' : ''}>
                        <span class="${sub.completed ? 'completed' : ''}">${sub.title}</span>
                    </div>
                `).join('');

                item.innerHTML = `
                    <div class="task-item-main">
                        <div class="task-item-header">
                            <span class="task-title">${task.title}</span>
                            <select class="task-status-select" data-id="${task.id}">
                                <option value="not-started" ${task.status === 'not-started' ? 'selected' : ''}>Non commencé</option>
                                <option value="in-progress" ${task.status === 'in-progress' ? 'selected' : ''}>En cours</option>
                                <option value="completed" ${task.status === 'completed' ? 'selected' : ''}>Terminé</option>
                            </select>
                        </div>
                        <div class="task-item-body">
                            <p>${task.description || ''}</p>
                            <div class="task-meta">
                                ${task.dueDate ? `<div class="due-date">Échéance: ${task.dueDate}</div>` : ''}
                                ${task.assignee ? `<div class="assignee">Assigné à: ${task.assignee}</div>` : ''}
                            </div>
                            <div class="subtask-container">
                                <h4>Sous-tâches</h4>
                                ${subtasksHTML}
                                <form class="add-subtask-form" data-id="${task.id}">
                                    <input type="text" class="subtask-input" placeholder="Ajouter une sous-tâche...">
                                    <button type="submit">+</button>
                                </form>
                            </div>
                        </div>
                    </div>
                `;
                taskList.appendChild(item);
            });
        });
    }

    function renderGroceries() {
        const addGroceryForm = $('#add-grocery-form');
        if (addGroceryForm) {
            addGroceryForm.addEventListener('submit', e => {
                e.preventDefault();
                const itemName = $('#grocery-item-name').value;
                if(itemName) refs.groceries.add({ name: itemName, completed: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
                addGroceryForm.reset();
            });
        }

        refs.groceries.orderBy('completed').orderBy('createdAt', 'asc').onSnapshot(snap => {
            const groceryList = $('#grocery-list');
            if (!groceryList) return;
            groceryList.innerHTML = '';
            snap.forEach(doc => {
                const itemData = {id: doc.id, ...doc.data()};
                const item = document.createElement('div');
                item.className = `grocery-item ${itemData.completed ? 'completed' : ''}`;
                item.innerHTML = `<input type="checkbox" ${itemData.completed ? 'checked' : ''}><span>${itemData.name}</span>`;
                item.querySelector('input').addEventListener('change', (e) => refs.groceries.doc(itemData.id).update({ completed: e.target.checked }));
                groceryList.appendChild(item);
            });
        });
    }

    async function generateWeeklyGroceryList() {
        if (!confirm("Voulez-vous remplacer la liste d'épicerie actuelle par une nouvelle liste générée pour les 7 prochains jours ?")) {
            return;
        }

        const ingredientMap = new Map();
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(startDate.getDate() + 7);

        const parseQuantity = (qte) => {
            if (!qte) return 0;
            if (String(qte).includes('/')) {
                const parts = qte.split('/');
                return parseFloat(parts[0]) / parseFloat(parts[1]);
            }
            return parseFloat(String(qte).replace(',', '.'));
        };

        const normalizeName = (name) => {
            let lower = name.toLowerCase().trim();
            if (lower.endsWith('s') || lower.endsWith('x')) {
                lower = lower.slice(0, -1);
            }
            return lower;
        };

        const addIngredient = (item) => {
            const normalized = normalizeName(item.nom);
            const quantity = parseQuantity(item.qte);

            if (ingredientMap.has(normalized)) {
                const existing = ingredientMap.get(normalized);
                if (typeof quantity === 'number' && !isNaN(quantity)) {
                    existing.total += quantity;
                }
            } else {
                ingredientMap.set(normalized, {
                    total: quantity,
                    unit: item.unite || '',
                    originalName: item.nom
                });
            }
        };

        const addTextIngredient = (text) => {
            const normalized = normalizeName(text);
            if (!ingredientMap.has(normalized)) {
                ingredientMap.set(normalized, {
                    total: 0,
                    unit: '',
                    originalName: text
                });
            }
        };

        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split('T')[0];
            const current = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0);

            const manualDoc = await refs.meals.doc(dateStr).get();
            const manual = manualDoc.data() || {};

            const diffDays = Math.floor((current - cycleStartDate) / (1000 * 3600 * 24));
            const week = (Math.floor(diffDays / 7) % 3) + 1;
            const dayName = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][current.getDay()];

            for (const repas of ['Déjeuner', 'Souper']) {
                const mealTypeLower = repas.toLowerCase();
                const manualMeal = manual ? manual[mealTypeLower] : undefined;
                const autoMeal = allRecipes.find(r => r.Semaine == week && r.Jour === dayName && r.Repas === repas);

                const mealToConsider = manualMeal !== undefined ? manualMeal : (autoMeal ? { recipeId: autoMeal.id } : null);

                if (mealToConsider && mealToConsider.recipeId) {
                    const recipe = allRecipes.find(r => r.id === mealToConsider.recipeId);
                    if (recipe && recipe.Ingrédients) {
                        try {
                            let ingredients = JSON.parse(recipe.Ingrédients);
                            if (Array.isArray(ingredients)) {
                                ingredients.forEach(ing => {
                                    if (ing.nom) addIngredient(ing);
                                });
                            }
                        } catch (e) {
                            String(recipe.Ingrédients).split('\n').map(i => i.trim()).filter(Boolean).forEach(i => addTextIngredient(i));
                        }
                    }
                }
            }
        }

        RECURRING_ITEMS.forEach(item => addTextIngredient(item));

        const finalList = Array.from(ingredientMap.values()).map(item => {
            if (item.total > 0) {
                const displayQty = Math.round(item.total * 100) / 100;
                return [displayQty, item.unit, item.originalName].filter(Boolean).join(' ');
            }
            return item.originalName;
        }).sort((a, b) => a.localeCompare(b));

        const batch = db.batch();
        const existingGroceries = await refs.groceries.get();
        existingGroceries.forEach(doc => batch.delete(doc.ref));

        finalList.forEach(name => {
            const newItemRef = refs.groceries.doc();
            batch.set(newItemRef, { name, completed: false, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        });

        await batch.commit();
        alert("Liste d'épicerie générée avec succès !");
    }

    function renderRecipeBook() {
        const sortedRecipes = [...allRecipes].sort((a, b) => (a.Semaine - b.Semaine) || ((DAY_ORDER[a.Jour] || 99) - (DAY_ORDER[b.Jour] || 99)));
        renderRecipeTable(sortedRecipes);

        const searchInput = $('#recipe-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const query = e.target.value.toLowerCase();
                const filteredRecipes = allRecipes.filter(r =>
                    Object.values(r).some(val => String(val).toLowerCase().includes(query))
                );
                renderRecipeTable(filteredRecipes);
            });
        }
    }

    function renderRecipeTable(recipes) {
        const table = $("#recipe-book-table");
        if (!table) return;

        if (recipes.length === 0) {
            table.innerHTML = '<thead><tr><th>Aucune recette trouvée.</th></tr></thead>';
            return;
        }

        const headers = ["Plat", "Repas", "Jour", "Semaine"];
        table.innerHTML = `
            <thead><tr>${headers.map(h => `<th data-sort="${h}">${h} ▾</th>`).join('')}</tr></thead>
            <tbody>${recipes.map(r => `<tr data-id="${r.id}">${headers.map(h => `<td>${r[h] || ''}</td>`).join('')}</tr>`).join('')}</tbody>
        `;

        table.querySelector('thead').addEventListener('click', e => {
            const header = e.target.closest('th');
            if (!header || !header.dataset.sort) return;

            const sortKey = header.dataset.sort;
            const currentDirection = sortState[sortKey] || 'asc';
            const newDirection = currentDirection === 'asc' ? 'desc' : 'asc';
            sortState = { [sortKey]: newDirection };

            const sorted = [...recipes].sort((a, b) => {
                const valA = a[sortKey], valB = b[sortKey];
                const modifier = newDirection === 'asc' ? 1 : -1;
                if (sortKey === 'Semaine') return (parseInt(valA) - parseInt(valB)) * modifier;
                if (sortKey === 'Jour') return ((DAY_ORDER[valA] || 99) - (DAY_ORDER[valB] || 99)) * modifier;
                return String(valA).localeCompare(String(valB)) * modifier;
            });
            renderRecipeTable(sorted);
        });

        table.querySelector('tbody').addEventListener('click', e => {
            const row = e.target.closest('tr');
            if (row && row.dataset.id) {
                showEditRecipeModal(row.dataset.id);
            }
        });
    }

    function showEditRecipeModal(recipeId = null, onSaveCallback = null) {
        const modal = $('#edit-recipe-modal');
        const form = $('#edit-recipe-form');
        const title = $('#edit-recipe-title');
        form.innerHTML = '';

        const recipe = recipeId ? allRecipes.find(r => r.id === recipeId) : {};
        title.textContent = recipeId ? 'Modifier la recette' : 'Ajouter une nouvelle recette';

        const fields = ['Plat', 'Repas', 'Jour', 'Semaine', 'Ingrédients', 'Recette', 'Image', 'Lien'];
        fields.forEach(field => {
            const value = recipe[field] || '';
            const isTextarea = ['Ingrédients', 'Recette'].includes(field);
            const inputType = isTextarea ?
                `<textarea name="${field}" rows="5">${value}</textarea>` :
                `<input type="text" name="${field}" value="${value}">`;

            form.innerHTML += `<div class="form-group"><label>${field}</label>${inputType}</div>`;
        });

        let formActionsHTML = `<button type="submit">Sauvegarder</button>`;
        if (recipeId) {
            formActionsHTML += `<button type="button" id="delete-recipe-btn" class="btn-danger">Supprimer</button>`;
        }
        form.innerHTML += `<div class="form-actions">${formActionsHTML}</div>`;

        form.onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const newRecipeData = Object.fromEntries(formData.entries());

            const docRef = recipeId ? refs.recipes.doc(recipeId) : refs.recipes.doc();
            await docRef.set(newRecipeData, { merge: true });

            const recipesSnap = await refs.recipes.get();
            allRecipes = recipesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            closeModal('edit-recipe-modal');

            if (onSaveCallback) {
                onSaveCallback();
            } else {
                renderMainContent();
            }
        };

        if (recipeId) {
            const deleteBtn = form.querySelector('#delete-recipe-btn');
            deleteBtn.onclick = async () => {
                if (confirm("Êtes-vous sûr de vouloir supprimer cette recette ? Cette action est irréversible.")) {
                    await refs.recipes.doc(recipeId).delete();
                    allRecipes = allRecipes.filter(r => r.id !== recipeId);
                    renderMainContent();
                    closeModal('edit-recipe-modal');
                }
            };
        }

        openModal('edit-recipe-modal');
    }

    function renderSettings() {
        const userList = $('#user-list');
        if (!userList) return;

        userList.addEventListener('click', (e) => {
            if (e.target.classList.contains('delete-user-btn')) {
                const userId = e.target.dataset.id;
                if (confirm("Êtes-vous sûr de vouloir supprimer cet utilisateur ?")) {
                    refs.users.doc(userId).delete();
                }
            }
        });

        refs.users.onSnapshot(snap => {
            userList.innerHTML = '';
            snap.forEach(doc => {
                const user = { id: doc.id, ...doc.data() };
                const item = document.createElement('div');
                item.className = 'user-item';
                item.innerHTML = `
                    <span class="user-color-swatch" style="background-color: ${user.color};"></span>
                    <span>${user.name}</span>
                    <button class="delete-user-btn" data-id="${user.id}">&times;</button>
                `;
                userList.appendChild(item);
            });
        });
    }

    renderMainContent();
}