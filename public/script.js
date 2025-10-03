// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyDyJHwJ_Kdh46hElqo95csljR1uUT5uefo", authDomain: "family-hub-ade15.firebaseapp.com", projectId: "family-hub-ade15",
    storageBucket: "family-hub-ade15.appspot.com", messagingSenderId: "21892917935", appId: "1:2189291-ade15.web.app/favicon.ico",
    measurementId: "G-Z4LCVLXBTT"
};

const MEMBER_COLORS = { 'Papa': '#d1e7ff', 'Maman': '#f8d7da', 'Gardienne': '#d4edda', 'Enfants': '#fff3cd' };
const CATEGORY_COLORS = { 'Rendez-vous': '#f5c6cb', 'École': '#ffeeba', 'Activité': '#b8daff', 'Tâche': '#a3cfbb', 'Repas': '#e2e3e5' };
const DAY_ORDER = { 'Lundi': 1, 'Mardi': 2, 'Mercredi': 3, 'Jeudi': 4, 'Vendredi': 5, 'Samedi': 6, 'Dimanche': 7 };
const RECURRING_ITEMS = ["Lait", "Jus d'orange", "Jambon", "Pain", "Fromage en tranches", "Œufs", "Yogourt", "Fruits variés (collations)"];

// --- INITIALISATION FIREBASE ---
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// --- SÉLECTEURS DOM ---
const $ = (selector) => document.querySelector(selector);
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
    const familyId = "defaultFamily";
    const refs = {
        recipes: db.collection(`families/${familyId}/recipes`),
        meals: db.collection(`families/${familyId}/meals`),
        events: db.collection(`families/${familyId}/calendarEvents`),
        tasks: db.collection(`families/${familyId}/tasks`),
        groceries: db.collection(`families/${familyId}/groceries`),
        settings: db.collection(`families/${familyId}/settings`),
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
    // Approche directe pour garantir le fonctionnement
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
                // --- Data Normalization on Import ---
                // Check if ingredients are a simple list and not the structured format.
                if (recipe.Ingrédients && !recipe.Ingrédients.trim().startsWith('[')) {
                    // Convert the simple list into the structured JSON format.
                    const ingredientsArray = recipe.Ingrédients.split('\n')
                        .map(line => line.trim())
                        .filter(line => line)
                        .map(line => {
                            // A simple conversion: assume the whole line is the name.
                            // More complex parsing could be added here later if needed.
                            return { qte: '', unite: '', nom: line };
                        });
                    // Store the normalized, structured data.
                    recipe.Ingrédients = JSON.stringify(ingredientsArray);
                }
                
                batch.set(refs.recipes.doc(), recipe);
            }
        });

        // --- Set the new cycle start date to the next Monday ---
        const today = new Date();
        const dayOfWeek = today.getDay(); // Sunday = 0, Monday = 1, etc.
        const daysUntilMonday = (dayOfWeek === 0) ? 1 : (8 - dayOfWeek);
        const nextMonday = new Date(today);
        nextMonday.setDate(today.getDate() + daysUntilMonday);
        nextMonday.setHours(0, 0, 0, 0); // Normalize to the start of the day

        // Save the new start date to Firestore
        await refs.settings.doc('mealCycle').set({ startDate: nextMonday });
        cycleStartDate = nextMonday; // Update the in-app variable

        await batch.commit();
        alert(`Recettes importées avec succès!`);
        
        await fetchAndSortRecipes(); // Re-fetch and re-sort recipes
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

    // Fetch meal cycle start date from settings
    const settingsDoc = await refs.settings.doc('mealCycle').get();
    if (settingsDoc.exists) {
        cycleStartDate = settingsDoc.data().startDate.toDate();
    }

    async function fetchAndSortRecipes() {
        const recipesSnap = await refs.recipes.get();
        allRecipes = recipesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Tri des recettes pour assurer la cohérence de la recherche de repas automatiques
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
            // Use setTimeout to ensure the DOM is updated before we try to access it.
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
        }
    }

    // --- TABLEAU DE BORD ---
    async function renderDashboard() {
        const today = new Date();
        const dateStr = today.toISOString().split('T')[0];
        
        // Meals
        const mealDoc = await refs.meals.doc(dateStr).get();
        const mealData = mealDoc.data() || {};
        const dashboardMeals = $('#dashboard-meals');
        dashboardMeals.innerHTML = '<h3>Repas</h3>';
        ['Déjeuner', 'Souper'].forEach(repas => {
            const meal = mealData[repas.toLowerCase()];
            dashboardMeals.innerHTML += `<p><strong>${repas}:</strong> ${meal && meal.plat ? meal.plat : 'Non planifié'}</p>`;
        });

        // Tasks
        const tasksSnap = await refs.tasks.where('dueDate', '==', dateStr).where('completed', '==', false).get();
        const dashboardTasks = $('#dashboard-tasks');
        dashboardTasks.innerHTML = '<h3>Tâches du jour</h3>';
        if (tasksSnap.empty) dashboardTasks.innerHTML += '<p>Aucune tâche pour aujourd\'hui.</p>';
        else tasksSnap.forEach(doc => dashboardTasks.innerHTML += `<p>${doc.data().title}</p>`);

        // Groceries Quick Add
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

    // --- CALENDRIER ---
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
                            <div class="meal-slot" data-meal-type="Déjeuner" id="dejeuner-${dateStr}"></div>
                            <div class="meal-slot" data-meal-type="Souper" id="souper-${dateStr}"></div>
                        </div>
                        <div class="day-events"></div>
                    </div>
                </div>`;
        }

        // Ajout des écouteurs d'événements après la création du HTML
        const prevBtn = $("#prev-month-btn");
        const nextBtn = $("#next-month-btn");
        if (prevBtn && nextBtn) {
            prevBtn.onclick = () => { currentDate.setMonth(currentDate.getMonth() - 1); renderCalendar(currentDate); };
            nextBtn.onclick = () => { currentDate.setMonth(currentDate.getMonth() + 1); renderCalendar(currentDate); };
        }
        
        listenForCalendarData(year, month);
    }

    function listenForCalendarData(year, month) {
        // Logique pour écouter les repas (meals)
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
                    
                    const mealToDisplay = manualMeal !== undefined ? manualMeal : (autoMeal ? { recipeId: autoMeal.id, plat: autoMeal.Plat } : null);
                    updateMealSlot(`${mealTypeLower}-${dateStr}`, mealToDisplay);
                });
            });
        });

        // Logique pour écouter les événements (calendarEvents)
        refs.events.onSnapshot(snap => {
            // D'abord, enlever les anciens événements pour éviter les doublons
            document.querySelectorAll('.event-item').forEach(el => el.remove());

            snap.forEach(doc => {
                const event = { id: doc.id, ...doc.data() };
                const dayCell = document.querySelector(`.calendar-day[data-date="${event.date}"]`);
                if (dayCell) {
                    const eventsContainer = dayCell.querySelector('.day-events'); // Keep events in their own container
                    const eventEl = document.createElement('div');
                    eventEl.className = 'event-item';
                    eventEl.textContent = event.title;
                    eventEl.dataset.eventId = event.id;
                    // Appliquer la couleur de la catégorie et une couleur de texte contrastante
                    eventEl.style.backgroundColor = CATEGORY_COLORS[event.category] || '#e2e3e5';
                    eventEl.style.color = '#333';
                    eventsContainer.appendChild(eventEl);
                }
            });
        });
    }

    // --- GESTION DES REPAS ---
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
                let ingredientsString = recipe.Ingrédients;
                let ingredients;

                // First, try to parse as valid JSON
                try {
                    ingredients = JSON.parse(ingredientsString);
                } catch (e) {
                    // If it fails, use the custom parser for the malformed format
                    if (ingredientsString.includes('{qte:')) {
                        ingredients = parseMalformedJson(ingredientsString);
                    } else {
                        // If it's not the malformed object format, treat as a simple list
                        throw new Error("Not a known object format, treating as a list.");
                    }
                }

                if (Array.isArray(ingredients)) {
                    ingredientsHTML = '<ul>' + ingredients.map(ing => {
                        const parts = [ing.qte, ing.unite, ing.nom].filter(Boolean); // Filter out empty/null parts
                        return `<li>${parts.join(' ')}</li>`;
                    }).join('') + '</ul>';
                }
            } catch (e) {
                console.error("Could not parse ingredients, falling back to plain text.", e);
                // If parsing fails, treat it as a simple newline-separated string
                ingredientsHTML = `<ul>${recipe.Ingrédients.split('\n').map(i => `<li>${i}</li>`).join('')}</ul>`;
            }
        }

        $("#recipe-details-content").innerHTML = `
            <h3>${recipe.Plat}</h3>
            <h4>Ingrédients :</h4>
            ${ingredientsHTML}
            <h4>Recette :</h4>
            <pre>${recipe.Recette || ''}</pre>
        `;
        
        // Logique pour assigner un chef
        const chefContainer = $("#chef-assignment-container");
        const chefOptions = Object.keys(MEMBER_COLORS).map(chef => `<option value="${chef}">${chef}</option>`).join('');
        chefContainer.innerHTML = `<label for="chef-select">Chef assigné :</label>
                                 <select id="chef-select"><option value="">-- Choisir --</option>${chefOptions}</select>`;
        
        refs.meals.doc(activeDate).get().then(doc => {
            if (doc.exists && doc.data()[activeMealType.toLowerCase()]) {
                $("#chef-select").value = doc.data()[activeMealType.toLowerCase()].chef || "";
            }
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

    function parseMalformedJson(str) {
        const result = [];
        // Remove outer brackets and split into individual object strings
        const objects = str.replace(/^\[|\]$/g, '').split('},{');

        objects.forEach(objStr => {
            const obj = {};
            // Clean up braces from split
            objStr = objStr.replace(/^{|}$/g, '');
            
            // Split by comma, but not commas inside a value
            const pairs = objStr.split(',');

            let currentKey = '';
            let currentValue = '';

            pairs.forEach(pair => {
                const parts = pair.split(':');
                const key = parts[0].trim();
                const value = parts.slice(1).join(':').trim();

                if (['qte', 'unite', 'nom'].includes(key)) {
                    // If we find a new valid key, save the previous key-value pair
                    if (currentKey) {
                        obj[currentKey] = currentValue.trim();
                    }
                    currentKey = key;
                    currentValue = value;
                } else {
                    // This part is a continuation of the previous value (e.g., a comma in the name)
                    currentValue += ',' + pair;
                }
            });
            // Save the last key-value pair
            if (currentKey) {
                obj[currentKey] = currentValue.trim();
            }
            result.push(obj);
        });
        return result;
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
            searchInput.value = ''; // Clear previous search
            searchInput.oninput = (e) => {
                const query = e.target.value.toLowerCase();
                document.querySelectorAll('.recipe-select-item').forEach(item => {
                    item.style.display = item.textContent.toLowerCase().includes(query) ? 'block' : 'none';
                });
            };
        }

        openModal('recipe-select-modal');
    }
    
    // --- GESTION DES CLICS DANS LA MODALE DE SÉLECTION DE REPAS ---
    // Approche directe pour garantir le fonctionnement
    $('#recipe-select-modal').addEventListener('click', async (e) => {
        const target = e.target;
        const modal = $('#recipe-select-modal');
        const { date, mealType } = modal.dataset;

        if (!date || !mealType) return;

        const mealKey = mealType.toLowerCase();

        // Gérer le clic sur un item de recette
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
        // Gérer le clic sur le bouton "Retirer ce repas"
        else if (target.id === 'remove-meal-btn') {
            const update = { [mealKey]: null };
            await refs.meals.doc(date).set(update, { merge: true });
            closeModal('recipe-select-modal');
        }
        // Gérer le clic sur le bouton "Ajouter une recette"
        else if (target.id === 'add-new-recipe-btn') {
            showEditRecipeModal();
        }
    });

    // --- GESTION DES ÉVÉNEMENTS ---
    async function showEventModal(date, eventId = null) {
        const form = $('#event-form');
        form.reset();
        $('#event-id').value = eventId || '';
        $('#event-date').value = date || '';
        $('#delete-event-btn').style.display = eventId ? 'inline-block' : 'none';
        $('#event-modal-title').textContent = eventId ? 'Modifier l\'événement' : 'Ajouter un événement';

        // Populate categories and assignees
        $('#event-category').innerHTML = Object.keys(CATEGORY_COLORS).map(cat => `<option>${cat}</option>`).join('');
        $('#event-assignees').innerHTML = Object.keys(MEMBER_COLORS).map(member => 
            `<div><input type="checkbox" id="assignee-${member}" value="${member}"><label for="assignee-${member}">${member}</label></div>`
        ).join('');

        if (eventId) {
            const doc = await refs.events.doc(eventId).get();
            if (doc.exists) {
                const event = doc.data();
                $('#event-title').value = event.title;
                $('#event-category').value = event.category;
                $('#event-date').value = event.date; // Overwrite date if editing
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

    // --- GESTION DES ÉVÉNEMENTS DÉLÉGUÉS ---
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
        // Then handle interactions with the main content area
        else if (target.closest('.meal-slot')) {
            const mealSlot = target.closest('.meal-slot');
            // Set activeDate and activeMealType for other functions to use
            activeDate = mealSlot.id.substring(mealSlot.id.indexOf('-') + 1);
            activeMealType = mealSlot.dataset.mealType;

            const mealData = JSON.parse(mealSlot.dataset.mealData || '{}');
            if (mealData.recipeId) {
                showRecipeDetails(mealData.recipeId);
            } else {
                // Pass the context to the modal before opening it
                const recipeSelectModal = $('#recipe-select-modal');
                recipeSelectModal.dataset.date = activeDate;
                recipeSelectModal.dataset.mealType = activeMealType;
                showRecipeSelection();
            }

        } else if (target.closest('.event-item')) {
            showEventModal(null, target.closest('.event-item').dataset.eventId);
        } else if (target.closest('.calendar-day[data-date]')) {
            // This should be last to act as a fallback for clicking on an empty day area
            if (!target.closest('.day-content')) { // Avoid triggering when clicking inside content
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
                assignees: assignees
            };
            if (eventId) await refs.events.doc(eventId).update(eventData);
            else await refs.events.add(eventData);
            closeModal('event-modal');
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
        
        slot.style.backgroundColor = 'transparent'; // Reset color

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

    // --- TÂCHES ---
    function renderTasks() {
        const assigneeSelect = $('#task-assignee');
        if (assigneeSelect) {
            assigneeSelect.innerHTML = Object.keys(MEMBER_COLORS).map(m => `<option>${m}</option>`).join('');
        }
        
        const addTaskForm = $('#add-task-form');
        if (addTaskForm) {
            addTaskForm.addEventListener('submit', e => {
                e.preventDefault();
                refs.tasks.add({
                    title: $('#task-title').value,
                    description: $('#task-description').value,
                    dueDate: $('#task-due-date').value,
                    assignee: $('#task-assignee').value,
                    completed: false,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });
                addTaskForm.reset();
            });
        }

        refs.tasks.orderBy('createdAt', 'asc').onSnapshot(snap => {
            const taskList = $('#task-list');
            if (!taskList) return;
            taskList.innerHTML = '';
            snap.forEach(doc => {
                const task = {id: doc.id, ...doc.data()};
                const item = document.createElement('div');
                item.className = `task-item ${task.completed ? 'completed' : ''}`;
                item.innerHTML = `
                    <input type="checkbox" ${task.completed ? 'checked' : ''}>
                    <div class="task-item-details">
                        <span>${task.title}</span>
                        ${task.dueDate ? `<div class="due-date">Échéance: ${task.dueDate}</div>` : ''}
                        ${task.assignee ? `<div class="assignee" style="color:${MEMBER_COLORS[task.assignee] || '#333'}">Assigné à: ${task.assignee}</div>` : ''}
                    </div>
                `;
                item.querySelector('input').addEventListener('change', (e) => refs.tasks.doc(task.id).update({ completed: e.target.checked }));
                taskList.appendChild(item);
            });
        });
    }
    
    // --- ÉPICERIE ---
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
    
    // --- GÉNÉRATION DE LA LISTE D'ÉPICERIE ---
    async function generateWeeklyGroceryList() {
        if (!confirm("Voulez-vous remplacer la liste d'épicerie actuelle par une nouvelle liste générée pour les 7 prochains jours ?")) {
            return;
        }

        const ingredientMap = new Map();
        const startDate = new Date();
        const endDate = new Date();
        endDate.setDate(startDate.getDate() + 7);

        // --- Helper functions for aggregation ---
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
            // Simple pluralization rule for this context
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
                // If units differ, we could add more complex logic here. For now, keep the first one.
            } else {
                ingredientMap.set(normalized, {
                    total: quantity,
                    unit: item.unite || '',
                    originalName: item.nom // Keep original name for display
                });
            }
        };

        const addTextIngredient = (text) => {
            const normalized = normalizeName(text);
            if (!ingredientMap.has(normalized)) {
                ingredientMap.set(normalized, {
                    total: 0, // No quantity to sum
                    unit: '',
                    originalName: text
                });
            }
        };

        // 1. Iterate through the next 7 days to find planned meals
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
                            let ingredients;
                            // Use the same robust parsing logic as showRecipeDetails
                            try {
                                ingredients = JSON.parse(recipe.Ingrédients);
                            } catch (e) {
                                if (recipe.Ingrédients.includes('{qte:')) {
                                    ingredients = parseMalformedJson(recipe.Ingrédients);
                                } else {
                                    throw new Error("Not a known object format, treating as a list.");
                                }
                            }

                            if (Array.isArray(ingredients)) {
                                ingredients.forEach(ing => {
                                    if (ing.nom) addIngredient(ing);
                                });
                            }
                        } catch (e) {
                            // Fallback for simple newline-separated strings or other formats
                            String(recipe.Ingrédients).split('\n').map(i => i.trim()).filter(Boolean).forEach(i => addTextIngredient(i));
                        }
                    }
                }
            }
        }

        // 2. Add recurring items
        RECURRING_ITEMS.forEach(item => addTextIngredient(item));

        // 3. Format the aggregated list for display and sort alphabetically
        const finalList = Array.from(ingredientMap.values()).map(item => {
            if (item.total > 0) {
                // Round fractions to 2 decimal places for readability
                const displayQty = Math.round(item.total * 100) / 100;
                return [displayQty, item.unit, item.originalName].filter(Boolean).join(' ');
            }
            return item.originalName;
        }).sort((a, b) => a.localeCompare(b));

        // 4. Update Firestore
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

    // --- LIVRE DE RECETTES ---
    function renderRecipeBook() {
        // Initial sort before rendering
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
            sortState = { [sortKey]: newDirection }; // Reset sort state to the current column

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

    // --- GESTION DES RECETTES (MODALE) ---
    function showEditRecipeModal(recipeId = null) {
        const modal = $('#edit-recipe-modal');
        const form = $('#edit-recipe-form');
        const title = $('#edit-recipe-title');
        form.innerHTML = ''; // Clear previous form

        const recipe = recipeId ? allRecipes.find(r => r.id === recipeId) : {};
        title.textContent = recipeId ? 'Modifier la recette' : 'Ajouter une nouvelle recette';

        const fields = ['Plat', 'Repas', 'Jour', 'Semaine', 'Ingrédients', 'Recette'];
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

        // --- Form Submission (Save) ---

        form.onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const newRecipeData = Object.fromEntries(formData.entries());

            const docRef = recipeId ? refs.recipes.doc(recipeId) : refs.recipes.doc();
            await docRef.set(newRecipeData, { merge: true });
            
            // Refresh local data and view
            const recipesSnap = await refs.recipes.get();
            allRecipes = recipesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            renderMainContent();

            closeModal('edit-recipe-modal');
        };

        // --- Delete Button Handler ---
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

    // Initialisation
    renderMainContent();
}